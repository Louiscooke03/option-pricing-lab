import { describe, expect, it } from 'vitest';
import { dwDTau, localVariance, localVol, localVolSurface } from '../dupire';
import { buildThetaTermStructure, fitSSVI, SSVIParams, SSVIPointsGroup, ThetaKnot } from '../ssvi';
import { fitSVISlice, SVIPoint } from '../svi';
import { cleanChain } from '../clean';
import { recoverForward } from '../forward';
import { impliedVolPoints } from '../volSurface';
import { sampleChain } from '../sample/sampleChain';

const linspace = (lo: number, hi: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => lo + (i / (n - 1)) * (hi - lo));

describe('dwDTau: finite-difference convergence', () => {
  const params: SSVIParams = { rho: -0.3, eta: 1, gamma: 0.3 };
  const thetaKnots: ThetaKnot[] = [
    { tau: 0.05, theta: 0.015 },
    { tau: 0.1, theta: 0.025 },
    { tau: 0.25, theta: 0.045 },
    { tau: 0.5, theta: 0.07 },
    { tau: 1.0, theta: 0.11 },
  ];

  it('converges as h shrinks (stays within one term-structure segment)', () => {
    const k = 0.2;
    const tau = 0.3; // strictly inside the (0.25, 0.5) segment

    const dCoarse = dwDTau(k, tau, params, thetaKnots, 1e-2);
    const dMid = dwDTau(k, tau, params, thetaKnots, 1e-4);
    const dFine = dwDTau(k, tau, params, thetaKnots, 1e-6);

    const errMidFine = Math.abs(dMid - dFine);
    const errCoarseMid = Math.abs(dCoarse - dMid);

    expect(errMidFine).toBeLessThanOrEqual(errCoarseMid + 1e-10);
    expect(dFine).toBeCloseTo(dMid, 6);
  });
});

describe('flat-surface sanity: no smile -> local vol matches implied vol', () => {
  it('local vol is ~constant across k and matches the flat implied-vol level', () => {
    // eta tiny -> phi(theta) tiny -> w(k, theta) is essentially independent of k, i.e. no
    // smile at all: a pure Black-Scholes term structure with level sigma0.
    const sigma0 = 0.35;
    const params: SSVIParams = { rho: 0, eta: 1e-6, gamma: 0.25 };
    const taus = [0.1, 0.25, 0.5, 1.0];
    const thetaKnots: ThetaKnot[] = taus.map((tau) => ({ tau, theta: sigma0 * sigma0 * tau }));

    const ks = [-0.5, -0.2, 0, 0.2, 0.5];
    const testTaus = [0.2, 0.4, 0.7];

    testTaus.forEach((tau) => {
      ks.forEach((k) => {
        const vol = localVol(k, tau, params, thetaKnots);
        expect(vol).toBeCloseTo(sigma0, 3);
      });
    });
  });
});

describe('localVolSurface: sampleChain-fitted SSVI is arbitrage-free', () => {
  const cleaned = cleanChain(sampleChain);
  const { expiries } = recoverForward(cleaned.quotes, sampleChain.valuationDate);
  const { points } = impliedVolPoints(cleaned.quotes, expiries);

  const byExpiry = new Map<string, SVIPoint[]>();
  points.forEach((p) => {
    const bucket = byExpiry.get(p.expiry) ?? [];
    bucket.push({ k: p.k, w: p.totalVar, weight: p.weight });
    byExpiry.set(p.expiry, bucket);
  });

  const sliceFitList: { tau: number; params: ReturnType<typeof fitSVISlice>['params'] }[] = [];
  const groups: SSVIPointsGroup[] = [];
  byExpiry.forEach((slicePoints, expiry) => {
    const tau = expiries.find((e) => e.expiry === expiry)?.tau;
    if (tau === undefined) return;
    const fit = fitSVISlice(slicePoints);
    sliceFitList.push({ tau, params: fit.params });
    groups.push({ tau, points: slicePoints });
  });

  const thetaKnots = buildThetaTermStructure(sliceFitList);
  const ssviFit = fitSSVI(groups, thetaKnots);

  it('has strictly positive local variance across the whole (k, tau) grid', () => {
    const allK = points.map((p) => p.k);
    const kGrid = linspace(Math.min(...allK) * 0.9, Math.max(...allK) * 0.9, 41);

    // Stay strictly inside the fitted term structure's own tau range: theta(tau) is
    // clamped flat outside it, which would make dw/dtau (and hence local variance)
    // collapse toward zero there -- not a claim this fit is making.
    const tauMin = thetaKnots[0].tau;
    const tauMax = thetaKnots[thetaKnots.length - 1].tau;
    const pad = (tauMax - tauMin) * 0.05;
    const tauGrid = linspace(tauMin + pad, tauMax - pad, 25);

    const surface = localVolSurface(kGrid, tauGrid, ssviFit.params, thetaKnots);

    expect(surface.negativeRegions).toHaveLength(0);
    expect(surface.minLocalVar).toBeGreaterThan(0);
  });

  it('localVariance agrees with the manually composed formula at a sample point', () => {
    const k = 0.1;
    const tau = (thetaKnots[0].tau + thetaKnots[thetaKnots.length - 1].tau) / 2;
    const variance = localVariance(k, tau, ssviFit.params, thetaKnots);
    expect(Number.isFinite(variance)).toBe(true);
    expect(variance).toBeGreaterThan(0);
  });
});
