import { butterflyG } from './arbitrage';
import { SSVIParams, ThetaKnot, ssviTotalVariance, ssviSliceToSVIParams, thetaOf } from './ssvi';

const DEFAULT_H = 1e-4;

export interface LocalVolSurfaceResult {
  /** sigma[i][j] = localVol(kGrid[j], tauGrid[i], ...). */
  sigma: number[][];
  minLocalVar: number;
  negativeRegions: { k: number; tau: number }[];
}

/**
 * dW/dtau at fixed k, by central finite difference of the SSVI total variance as tau
 * moves along the theta(tau) term structure. Falls back to a forward difference when
 * tau - h would be non-positive.
 */
export const dwDTau = (
  k: number,
  tau: number,
  params: SSVIParams,
  thetaKnots: ThetaKnot[],
  h: number = DEFAULT_H,
): number => {
  const wAt = (t: number): number => ssviTotalVariance(k, thetaOf(t, thetaKnots), params);

  if (tau - h <= 0) {
    return (wAt(tau + h) - wAt(tau)) / h;
  }
  return (wAt(tau + h) - wAt(tau - h)) / (2 * h);
};

/**
 * Dupire local variance in (k, tau) coordinates for an SSVI surface:
 * sigma_loc^2(k, tau) = (dw/dtau) / g(k, tau), where g is the Gatheral-Jacquier
 * butterfly indicator of the SSVI slice at that tau (reusing butterflyG from
 * lib/arbitrage.ts via the analytic SSVI-to-SVI slice conversion).
 */
export const localVariance = (
  k: number,
  tau: number,
  params: SSVIParams,
  thetaKnots: ThetaKnot[],
  h: number = DEFAULT_H,
): number => {
  const theta = thetaOf(tau, thetaKnots);
  const svi = ssviSliceToSVIParams(theta, params);
  const g = butterflyG(k, svi);
  const numerator = dwDTau(k, tau, params, thetaKnots, h);
  return numerator / g;
};

/** Local vol sigma_loc(k, tau) = sqrt(max(localVariance, 0)). */
export const localVol = (
  k: number,
  tau: number,
  params: SSVIParams,
  thetaKnots: ThetaKnot[],
  h: number = DEFAULT_H,
): number => Math.sqrt(Math.max(localVariance(k, tau, params, thetaKnots, h), 0));

/**
 * Evaluates local vol over a (tauGrid x kGrid) grid: sigma[i][j] = localVol(kGrid[j],
 * tauGrid[i]). Tracks the minimum local variance encountered and any (k, tau) where it
 * is non-positive -- which should not happen for an arbitrage-free SSVI fit.
 */
export const localVolSurface = (
  kGrid: number[],
  tauGrid: number[],
  params: SSVIParams,
  thetaKnots: ThetaKnot[],
): LocalVolSurfaceResult => {
  let minLocalVar = Infinity;
  const negativeRegions: { k: number; tau: number }[] = [];

  const sigma = tauGrid.map((tau) =>
    kGrid.map((k) => {
      const variance = localVariance(k, tau, params, thetaKnots);
      if (variance < minLocalVar) minLocalVar = variance;
      if (variance <= 0) negativeRegions.push({ k, tau });
      return Math.sqrt(Math.max(variance, 0));
    }),
  );

  return { sigma, minLocalVar, negativeRegions };
};
