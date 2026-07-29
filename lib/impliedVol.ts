import { black76Call, black76Put, black76Vega } from './bs';

const PRICE_TOL = 1e-8;
const MIN_SIGMA = 1e-4;
const MAX_SIGMA = 5;
const MAX_NEWTON_ITER = 50;
const MAX_BISECTION_ITER = 100;
const MIN_VEGA = 1e-8;
// Tolerance on the no-arbitrage bound check, to avoid rejecting prices that sit
// exactly on the boundary due to floating-point noise.
const BOUND_EPS = 1e-10;

const priceAt = (F: number, K: number, tau: number, sigma: number, DF: number, isCall: boolean): number =>
  isCall ? black76Call(F, K, tau, sigma, DF) : black76Put(F, K, tau, sigma, DF);

const bisectionSolve = (
  price: number,
  F: number,
  K: number,
  tau: number,
  DF: number,
  isCall: boolean,
): number | null => {
  let lo = MIN_SIGMA;
  let hi = MAX_SIGMA;
  let fLo = priceAt(F, K, tau, lo, DF, isCall) - price;
  let fHi = priceAt(F, K, tau, hi, DF, isCall) - price;

  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if (fLo * fHi > 0) {
    return null;
  }

  for (let i = 0; i < MAX_BISECTION_ITER; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = priceAt(F, K, tau, mid, DF, isCall) - price;

    if (Math.abs(fMid) < PRICE_TOL) {
      return mid;
    }

    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
};

/**
 * Solves for the Black-76 implied volatility reproducing `price`.
 * Returns null when the price violates no-arbitrage bounds, or when neither
 * Newton's method nor a bracketing fallback converge.
 */
export const impliedVol = (
  price: number,
  F: number,
  K: number,
  tau: number,
  DF: number,
  isCall: boolean,
): number | null => {
  const lowerBound = isCall ? DF * Math.max(F - K, 0) : DF * Math.max(K - F, 0);
  const upperBound = isCall ? DF * F : DF * K;

  if (price <= lowerBound + BOUND_EPS || price >= upperBound - BOUND_EPS) {
    return null;
  }

  // Brenner-Subrahmanyam ATM approximation, clamped to a sensible starting range.
  const atmEstimate = price / (0.4 * DF * F * Math.sqrt(tau));
  let sigma = Number.isFinite(atmEstimate) ? Math.min(Math.max(atmEstimate, 0.05), 3) : 0.2;

  for (let i = 0; i < MAX_NEWTON_ITER; i += 1) {
    const currentPrice = priceAt(F, K, tau, sigma, DF, isCall);
    const diff = currentPrice - price;

    if (Math.abs(diff) < PRICE_TOL) {
      return sigma;
    }

    const vega = black76Vega(F, K, tau, sigma, DF);
    if (vega < MIN_VEGA) {
      break;
    }

    const next = sigma - diff / vega;
    if (!Number.isFinite(next) || next <= 0 || next > MAX_SIGMA * 2) {
      break;
    }

    sigma = next;
  }

  const finalPrice = priceAt(F, K, tau, sigma, DF, isCall);
  if (Math.abs(finalPrice - price) < PRICE_TOL) {
    return sigma;
  }

  return bisectionSolve(price, F, K, tau, DF, isCall);
};
