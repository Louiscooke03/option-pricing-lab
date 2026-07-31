export interface NelderMeadOptions {
  /** Maximum number of iterations before giving up. Default 1000. */
  maxIter?: number;
  /** Stop once the simplex's function-value spread falls below this. Default 1e-10. */
  tol?: number;
  /** Initial step size used to build the starting simplex around x0. Default 0.1. */
  initialStep?: number;
}

export interface NelderMeadResult {
  x: number[];
  fx: number;
  iters: number;
  /** True if the simplex shrank below `tol` before `maxIter` was reached. */
  converged: boolean;
}

const REFLECTION = 1;
const EXPANSION = 2;
const CONTRACTION = 0.5;
const SHRINK = 0.5;

/**
 * Standard downhill-simplex (Nelder-Mead) minimiser. Dependency-free, works on any
 * f: R^n -> R. Not guaranteed to find a global minimum — callers doing non-convex
 * fits should use random restarts.
 */
export const nelderMead = (
  f: (x: number[]) => number,
  x0: number[],
  opts: NelderMeadOptions = {},
): NelderMeadResult => {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 1000;
  const tol = opts.tol ?? 1e-10;
  const initialStep = opts.initialStep ?? 0.1;

  if (n === 0) {
    throw new Error('nelderMead requires a non-empty starting point x0');
  }

  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i += 1) {
    const point = x0.slice();
    // Floor the step so a coordinate that happens to start near zero still gets a
    // usable simplex extent in that dimension, rather than a near-degenerate one.
    const step = Math.max(Math.abs(point[i]) * initialStep, initialStep);
    point[i] += step;
    simplex.push(point);
  }

  let values = simplex.map(f);

  let iters = 0;
  let converged = false;
  for (; iters < maxIter; iters += 1) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);

    const spread = Math.abs(values[n] - values[0]);
    if (spread < tol) {
      converged = true;
      break;
    }

    const best = simplex[0];
    const worst = simplex[n];
    const worstValue = values[n];
    const secondWorstValue = values[n - 1];

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        centroid[j] += simplex[i][j] / n;
      }
    }

    const reflect = (point: number[], coeff: number): number[] =>
      centroid.map((c, j) => c + coeff * (c - point[j]));

    const reflected = reflect(worst, REFLECTION);
    const reflectedValue = f(reflected);

    if (reflectedValue < values[0]) {
      const expanded = reflect(worst, EXPANSION);
      const expandedValue = f(expanded);
      if (expandedValue < reflectedValue) {
        simplex[n] = expanded;
        values[n] = expandedValue;
      } else {
        simplex[n] = reflected;
        values[n] = reflectedValue;
      }
      continue;
    }

    if (reflectedValue < secondWorstValue) {
      simplex[n] = reflected;
      values[n] = reflectedValue;
      continue;
    }

    const contracted = reflect(worst, reflectedValue < worstValue ? CONTRACTION : -CONTRACTION);
    const contractedValue = f(contracted);

    if (contractedValue < Math.min(worstValue, reflectedValue)) {
      simplex[n] = contracted;
      values[n] = contractedValue;
      continue;
    }

    for (let i = 1; i <= n; i += 1) {
      simplex[i] = best.map((b, j) => b + SHRINK * (simplex[i][j] - b));
      values[i] = f(simplex[i]);
    }
  }

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  return { x: simplex[order[0]], fx: values[order[0]], iters, converged };
};
