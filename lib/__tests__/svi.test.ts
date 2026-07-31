import { describe, expect, it } from 'vitest';
import { fitSVISlice, sviTotalVariance, SVIParams, SVIPoint } from '../svi';
import { cleanChain } from '../clean';
import { recoverForward } from '../forward';
import { impliedVolPoints } from '../volSurface';
import { sampleChain } from '../sample/sampleChain';

describe('fitSVISlice: synthetic recovery', () => {
  it('recovers the true w(k) curve to a small tolerance despite tiny noise', () => {
    const trueParams: SVIParams = { a: 0.02, b: 0.15, rho: -0.3, m: -0.05, sigma: 0.2 };

    const ks = Array.from({ length: 15 }, (_, i) => -0.7 + (i / 14) * 1.4);
    const points: SVIPoint[] = ks.map((k, i) => {
      // Deterministic tiny "noise" so the test isn't flaky, using a fixed pseudo-random offset.
      const noise = Math.sin(i * 12.9898) * 1e-6;
      return { k, w: sviTotalVariance(k, trueParams) + noise, weight: 1 };
    });

    const fit = fitSVISlice(points);

    expect(fit.converged).toBe(true);
    expect(fit.rmse).toBeLessThan(1e-3);

    const grid = Array.from({ length: 41 }, (_, i) => -0.7 + (i / 40) * 1.4);
    grid.forEach((k) => {
      const trueW = sviTotalVariance(k, trueParams);
      const fittedW = sviTotalVariance(k, fit.params);
      expect(fittedW).toBeCloseTo(trueW, 3);
    });
  });

  it('throws with fewer than 5 points', () => {
    const points: SVIPoint[] = [
      { k: -0.1, w: 0.02, weight: 1 },
      { k: 0, w: 0.015, weight: 1 },
      { k: 0.1, w: 0.02, weight: 1 },
    ];
    expect(() => fitSVISlice(points)).toThrow(/at least 5 points/);
  });
});

describe('fitSVISlice: bundled sample chain pipeline', () => {
  const cleaned = cleanChain(sampleChain);
  const { expiries } = recoverForward(cleaned.quotes, sampleChain.valuationDate);
  const { points } = impliedVolPoints(cleaned.quotes, expiries);

  const byExpiry = new Map<string, SVIPoint[]>();
  points.forEach((p) => {
    const bucket = byExpiry.get(p.expiry) ?? [];
    bucket.push({ k: p.k, w: p.totalVar, weight: p.weight });
    byExpiry.set(p.expiry, bucket);
  });

  it('fits every expiry slice with convergence, low rmse, and non-negative variance', () => {
    expect(byExpiry.size).toBeGreaterThan(0);

    byExpiry.forEach((slicePoints, expiry) => {
      const fit = fitSVISlice(slicePoints);

      expect(fit.converged, `expiry ${expiry} should converge`).toBe(true);
      expect(fit.rmse, `expiry ${expiry} rmse`).toBeLessThan(0.01);

      const kGrid = Array.from({ length: 41 }, (_, i) => -1 + (i / 40) * 2);
      kGrid.forEach((k) => {
        expect(sviTotalVariance(k, fit.params)).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
