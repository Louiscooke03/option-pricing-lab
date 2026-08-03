import { nelderMead } from './optim';
import { SVIParams, SVIPoint } from './svi';

export interface SSVIParams {
  /** Global correlation/skew parameter; |rho| < 1. */
  rho: number;
  /** Power-law curvature scale; eta > 0. */
  eta: number;
  /** Power-law curvature decay; 0 < gamma < 0.5. */
  gamma: number;
}

export interface ThetaKnot {
  tau: number;
  theta: number;
}

export interface SSVIPointsGroup {
  tau: number;
  points: SVIPoint[];
}

export interface SSVIFitResult {
  params: SSVIParams;
  rmse: number;
  converged: boolean;
}

export interface SSVIFitOptions {
  /** Number of random restarts around the initial guess. Default 8. */
  restarts?: number;
}

/** Power-law curvature: phi(theta) = eta * theta^(-gamma). */
export const phi = (theta: number, p: SSVIParams): number => p.eta * theta ** -p.gamma;

/**
 * SSVI total variance surface:
 * w(k, theta) = (theta/2) * (1 + rho*phi*k + sqrt((phi*k + rho)^2 + (1 - rho^2))).
 */
export const ssviTotalVariance = (k: number, theta: number, p: SSVIParams): number => {
  const phiTheta = phi(theta, p);
  const x = phiTheta * k + p.rho;
  return (theta / 2) * (1 + p.rho * phiTheta * k + Math.sqrt(x * x + (1 - p.rho * p.rho)));
};

/**
 * Interpolates the ATM total-variance term structure theta(tau) from a set of knots,
 * assumed sorted by tau ascending and already non-decreasing in theta (see
 * buildThetaTermStructure). Linear interpolation between knots preserves monotonicity;
 * clamps flat outside the knot range.
 */
export const thetaOf = (tau: number, knots: ThetaKnot[]): number => {
  if (knots.length === 0) {
    throw new Error('thetaOf requires at least one knot');
  }
  if (tau <= knots[0].tau) return knots[0].theta;
  if (tau >= knots[knots.length - 1].tau) return knots[knots.length - 1].theta;

  for (let i = 0; i < knots.length - 1; i += 1) {
    const left = knots[i];
    const right = knots[i + 1];
    if (tau >= left.tau && tau <= right.tau) {
      const t = right.tau === left.tau ? 0 : (tau - left.tau) / (right.tau - left.tau);
      return left.theta + t * (right.theta - left.theta);
    }
  }
  return knots[knots.length - 1].theta;
};

/**
 * Builds the ATM total-variance term structure theta(tau) = w(0, tau) from per-expiry
 * SVI slice fits, sorted by tau ascending. Any dip below the previous knot is clamped
 * up to it, so the calendar (non-decreasing-in-tau) condition holds by construction.
 */
export const buildThetaTermStructure = (
  sliceFits: { tau: number; params: SVIParams }[],
): ThetaKnot[] => {
  const sorted = [...sliceFits].sort((a, b) => a.tau - b.tau);
  const knots: ThetaKnot[] = [];

  sorted.forEach(({ tau, params }) => {
    const dk = 0 - params.m;
    const rawTheta = params.a + params.b * (params.rho * dk + Math.sqrt(dk * dk + params.sigma * params.sigma));
    const prevTheta = knots.length > 0 ? knots[knots.length - 1].theta : -Infinity;
    knots.push({ tau, theta: Math.max(rawTheta, prevTheta) });
  });

  return knots;
};

/**
 * Converts one SSVI (theta, params) slice to the equivalent raw five-parameter SVI
 * form (m=-rho/phi, sigma=sqrt(1-rho^2)/phi, b=theta*phi/2, a=theta/2*(1-rho^2)), so
 * the existing per-slice arbitrage guardrails (lib/arbitrage.ts) can be reused as-is
 * against an SSVI-derived slice.
 */
export const ssviSliceToSVIParams = (theta: number, p: SSVIParams): SVIParams => {
  const phiTheta = phi(theta, p);
  return {
    a: (theta / 2) * (1 - p.rho * p.rho),
    b: (theta * phiTheta) / 2,
    rho: p.rho,
    m: -p.rho / phiTheta,
    sigma: Math.sqrt(1 - p.rho * p.rho) / phiTheta,
  };
};

/** Evaluates the fitted SSVI surface w(k, tau) on a (tauGrid x kGrid) grid: surface[i][j] = w(kGrid[j], tauGrid[i]). */
export const ssviSurface = (
  kGrid: number[],
  tauGrid: number[],
  params: SSVIParams,
  thetaKnots: ThetaKnot[],
): number[][] =>
  tauGrid.map((tau) => {
    const theta = thetaOf(tau, thetaKnots);
    return kGrid.map((k) => ssviTotalVariance(k, theta, params));
  });

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (p: number): number => Math.log(p / (1 - p));
const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

const toUnconstrained = (p: SSVIParams): number[] => [
  Math.atanh(clamp(p.rho, -0.999, 0.999)),
  Math.log(Math.max(p.eta, 1e-8)),
  logit(clamp(p.gamma / 0.5, 1e-6, 1 - 1e-6)),
];

const fromUnconstrained = (x: number[]): SSVIParams => ({
  rho: Math.tanh(x[0]),
  eta: Math.exp(x[1]),
  gamma: 0.5 * sigmoid(x[2]),
});

// Gatheral-Jacquier no-butterfly-arbitrage bound for the power-law SSVI surface:
// theta*phi(theta)*(1+|rho|) must stay strictly below 4 at every theta on the term
// structure. Violating it anywhere makes the whole surface unusable, so it is
// penalised directly in the fitting objective rather than only checked after the fact.
const butterflyBoundPenalty = (thetaKnots: ThetaKnot[], params: SSVIParams): number => {
  let penalty = 0;
  thetaKnots.forEach(({ theta }) => {
    const bound = theta * phi(theta, params) * (1 + Math.abs(params.rho));
    if (bound >= 4) {
      const excess = bound - 4;
      penalty += 1e6 * excess * excess;
    }
  });
  return penalty;
};

/**
 * Fits one global SSVI surface (rho, eta, gamma) to points pooled across ALL expiries
 * by weighted least squares, using the ATM term structure theta(tau) as a fixed input
 * (see buildThetaTermStructure). Optimises in an unconstrained reparameterisation
 * (atanh rho, log eta, logit(gamma/0.5)) so |rho|<1, eta>0 and 0<gamma<0.5 hold
 * automatically, with a few random restarts kept-best since the objective is
 * non-convex, plus the Gatheral-Jacquier butterfly-bound penalty baked in.
 */
export const fitSSVI = (
  groups: SSVIPointsGroup[],
  thetaKnots: ThetaKnot[],
  opts: SSVIFitOptions = {},
): SSVIFitResult => {
  const flatPoints = groups.flatMap(({ tau, points }) => {
    const theta = thetaOf(tau, thetaKnots);
    return points.map((p) => ({ ...p, theta }));
  });

  if (flatPoints.length < 5) {
    throw new Error(`fitSSVI requires at least 5 points across all expiries, got ${flatPoints.length}`);
  }

  const objective = (x: number[]): number => {
    const params = fromUnconstrained(x);

    const residual = flatPoints.reduce((acc, p) => {
      const diff = ssviTotalVariance(p.k, p.theta, params) - p.w;
      return acc + p.weight * diff * diff;
    }, 0);

    return residual + butterflyBoundPenalty(thetaKnots, params);
  };

  const guess: SSVIParams = { rho: -0.3, eta: 1, gamma: 0.25 };
  const x0 = toUnconstrained(guess);
  const restarts = opts.restarts ?? 8;

  let best = nelderMead(objective, x0, { maxIter: 3000 });
  for (let i = 0; i < restarts; i += 1) {
    const perturbed = x0.map((v) => v + (Math.random() - 0.5) * 0.6);
    const attempt = nelderMead(objective, perturbed, { maxIter: 3000 });
    if (attempt.fx < best.fx) {
      best = attempt;
    }
  }

  const polished = nelderMead(objective, best.x, { maxIter: 5000, initialStep: 0.01 });
  if (polished.fx <= best.fx) {
    best = polished;
  }

  const params = fromUnconstrained(best.x);
  const totalWeight = flatPoints.reduce((acc, p) => acc + p.weight, 0);
  const weightedSquaredError = flatPoints.reduce((acc, p) => {
    const diff = ssviTotalVariance(p.k, p.theta, params) - p.w;
    return acc + p.weight * diff * diff;
  }, 0);
  const rmse = Math.sqrt(weightedSquaredError / totalWeight);

  return { params, rmse, converged: best.converged };
};
