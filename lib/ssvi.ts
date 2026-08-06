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
 * Fritsch-Carlson tangents for a monotone cubic Hermite (PCHIP) interpolant through
 * knots assumed sorted by x ascending and non-decreasing in y. Shape-preserving: the
 * resulting curve never overshoots and stays non-decreasing wherever the data is
 * non-decreasing (unlike a natural cubic spline, which can overshoot and violate
 * monotonicity between knots).
 */
const monotoneTangents = (knots: ThetaKnot[]): number[] => {
  const n = knots.length;
  if (n === 1) return [0];

  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(knots[i + 1].tau - knots[i].tau);
    delta.push((knots[i + 1].theta - knots[i].theta) / h[i]);
  }

  if (n === 2) return [delta[0], delta[0]];

  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  // Non-centered three-point endpoint derivative, clamped to preserve monotonicity
  // (standard PCHIP endpoint rule).
  const endpointTangent = (h0: number, h1: number, d0: number, d1: number): number => {
    let mEnd = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(mEnd) !== Math.sign(d0)) {
      mEnd = 0;
    } else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(mEnd) > 3 * Math.abs(d0)) {
      mEnd = 3 * d0;
    }
    return mEnd;
  };

  m[0] = endpointTangent(h[0], h[1], delta[0], delta[1]);
  m[n - 1] = endpointTangent(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);

  return m;
};

/** Evaluates the cubic Hermite basis on segment [knots[i], knots[i+1]] at tau. */
const hermiteEval = (tau: number, knots: ThetaKnot[], tangents: number[], i: number): number => {
  const left = knots[i];
  const right = knots[i + 1];
  const h = right.tau - left.tau;
  const s = (tau - left.tau) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * left.theta + h10 * h * tangents[i] + h01 * right.theta + h11 * h * tangents[i + 1];
};

/**
 * Interpolates the ATM total-variance term structure theta(tau) from a set of knots,
 * assumed sorted by tau ascending and already non-decreasing in theta (see
 * buildThetaTermStructure). Uses a monotone cubic Hermite (Fritsch-Carlson / PCHIP)
 * interpolant: shape-preserving (theta stays non-decreasing, so the calendar
 * no-arbitrage condition holds) and C1 (dtheta/dtau is continuous across interior
 * knots, unlike piecewise-linear interpolation, whose slope jumps at every knot and
 * otherwise leaks into a visible step in the Dupire local-vol surface). Clamps flat
 * outside the knot range -- the cubic is not extrapolated.
 */
export const thetaOf = (tau: number, knots: ThetaKnot[]): number => {
  if (knots.length === 0) {
    throw new Error('thetaOf requires at least one knot');
  }
  if (tau <= knots[0].tau) return knots[0].theta;
  if (tau >= knots[knots.length - 1].tau) return knots[knots.length - 1].theta;
  if (knots.length === 1) return knots[0].theta;

  const tangents = monotoneTangents(knots);

  for (let i = 0; i < knots.length - 1; i += 1) {
    const left = knots[i];
    const right = knots[i + 1];
    if (tau >= left.tau && tau <= right.tau) {
      return hermiteEval(tau, knots, tangents, i);
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
