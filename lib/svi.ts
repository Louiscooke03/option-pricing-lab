import { nelderMead } from './optim';

export interface SVIParams {
  /** Overall level of total variance. */
  a: number;
  /** Controls the angle/steepness of the wings; b >= 0. */
  b: number;
  /** Controls the skew/rotation of the smile; |rho| < 1. */
  rho: number;
  /** Horizontal shift of the smile's minimum, in log-moneyness. */
  m: number;
  /** Controls the curvature at the smile's minimum; sigma > 0. */
  sigma: number;
}

export interface SVIPoint {
  k: number;
  w: number;
  weight: number;
}

export interface SVIFitResult {
  params: SVIParams;
  rmse: number;
  converged: boolean;
}

export interface SVIFitOptions {
  /** Number of random restarts around the data-driven initial guess. Default 8. */
  restarts?: number;
}

/** Raw SVI total variance: w(k) = a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2)). */
export const sviTotalVariance = (k: number, p: SVIParams): number => {
  const dk = k - p.m;
  return p.a + p.b * (p.rho * dk + Math.sqrt(dk * dk + p.sigma * p.sigma));
};

/** Implied vol from an SVI slice: sqrt(w(k)/tau), clamped at 0 to guard w < 0. */
export const sviImpliedVol = (k: number, tau: number, p: SVIParams): number => {
  const w = Math.max(sviTotalVariance(k, p), 0);
  return Math.sqrt(w / tau);
};

const toUnconstrained = (p: SVIParams): number[] => [
  p.a,
  Math.log(Math.max(p.b, 1e-8)),
  Math.atanh(Math.min(Math.max(p.rho, -0.999), 0.999)),
  p.m,
  Math.log(Math.max(p.sigma, 1e-8)),
];

const fromUnconstrained = (x: number[]): SVIParams => ({
  a: x[0],
  b: Math.exp(x[1]),
  rho: Math.tanh(x[2]),
  m: x[3],
  sigma: Math.exp(x[4]),
});

const estimateInitialGuess = (points: SVIPoint[]): SVIParams => {
  const sorted = [...points].sort((p, q) => p.k - q.k);
  const minWPoint = sorted.reduce((best, p) => (p.w < best.w ? p : best), sorted[0]);

  const left = sorted[0];
  const right = sorted[sorted.length - 1];
  const kRange = Math.max(right.k - left.k, 1e-6);
  const wRange = Math.max(left.w, right.w) - minWPoint.w;
  const b0 = Math.min(Math.max(wRange / kRange, 0.01), 5);

  return {
    a: Math.max(minWPoint.w, 1e-6),
    b: b0,
    rho: -0.3,
    m: minWPoint.k,
    sigma: 0.1,
  };
};

const makeObjective = (points: SVIPoint[]) => (x: number[]): number => {
  const params = fromUnconstrained(x);

  const residual = points.reduce((acc, p) => {
    const diff = sviTotalVariance(p.k, params) - p.w;
    return acc + p.weight * diff * diff;
  }, 0);

  // No-negative-variance condition: a + b*sigma*sqrt(1-rho^2) >= 0.
  const nonNegVarianceTerm = params.a + params.b * params.sigma * Math.sqrt(1 - params.rho * params.rho);
  const penalty = nonNegVarianceTerm < 0 ? 1e6 * nonNegVarianceTerm * nonNegVarianceTerm : 0;

  return residual + penalty;
};

/**
 * Fits a raw five-parameter SVI slice to (k, w) points by weighted least squares.
 * Optimises in an unconstrained reparameterisation (a, log b, atanh rho, m, log sigma)
 * so b >= 0, |rho| < 1 and sigma > 0 hold automatically, with a few random restarts
 * kept-best since the objective is non-convex.
 */
export const fitSVISlice = (points: SVIPoint[], opts: SVIFitOptions = {}): SVIFitResult => {
  if (points.length < 5) {
    throw new Error(`fitSVISlice requires at least 5 points, got ${points.length}`);
  }

  const restarts = opts.restarts ?? 8;
  const objective = makeObjective(points);
  const guess = estimateInitialGuess(points);
  const x0 = toUnconstrained(guess);

  let best = nelderMead(objective, x0, { maxIter: 2000 });

  for (let i = 0; i < restarts; i += 1) {
    const perturbed = x0.map((v) => v + (Math.random() - 0.5) * 0.5);
    const attempt = nelderMead(objective, perturbed, { maxIter: 2000 });
    if (attempt.fx < best.fx) {
      best = attempt;
    }
  }

  // Polish: re-run from the best point found so far with a small initial step and a
  // tighter tolerance. A restart can land near the optimum with its own (relatively
  // coarse, 10%-step) simplex still not fully collapsed; a small-step re-run from
  // that point converges reliably.
  const polished = nelderMead(objective, best.x, { maxIter: 5000, initialStep: 0.01 });
  if (polished.fx <= best.fx) {
    best = polished;
  }

  const params = fromUnconstrained(best.x);
  const totalWeight = points.reduce((acc, p) => acc + p.weight, 0);
  const weightedSquaredError = points.reduce((acc, p) => {
    const diff = sviTotalVariance(p.k, params) - p.w;
    return acc + p.weight * diff * diff;
  }, 0);
  const rmse = Math.sqrt(weightedSquaredError / totalWeight);

  return { params, rmse, converged: best.converged };
};
