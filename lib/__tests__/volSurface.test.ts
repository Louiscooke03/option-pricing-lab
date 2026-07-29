import { describe, expect, it } from 'vitest';
import { cleanChain } from '../clean';
import { recoverForward } from '../forward';
import { sampleChain } from '../sample/sampleChain';
import { impliedVolPoints } from '../volSurface';

describe('impliedVolPoints: sample chain', () => {
  const cleaned = cleanChain(sampleChain);
  const { expiries } = recoverForward(cleaned.quotes, sampleChain.valuationDate);
  const { points, skipped } = impliedVolPoints(cleaned.quotes, expiries);

  it('produces no skipped strikes for the well-formed sample data', () => {
    expect(skipped).toHaveLength(0);
  });

  it('produces implied vols in a sane range', () => {
    expect(points.length).toBeGreaterThan(0);
    points.forEach((p) => {
      expect(p.iv).toBeGreaterThan(0.05);
      expect(p.iv).toBeLessThan(1.5);
    });
  });

  it('spans negative to positive log-moneyness across strikes', () => {
    const ks = points.map((p) => p.k);
    expect(Math.min(...ks)).toBeLessThan(0);
    expect(Math.max(...ks)).toBeGreaterThan(0);
  });

  it('computes totalVar as iv^2 * tau for every point', () => {
    points.forEach((p) => {
      expect(p.totalVar).toBeCloseTo(p.iv * p.iv * p.tau, 12);
    });
  });

  it('is sorted by (tau, k)', () => {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      expect(curr.tau > prev.tau || (curr.tau === prev.tau && curr.k >= prev.k)).toBe(true);
    }
  });

  it('shows the mild smile from the sample data: wings have iv >= ATM iv', () => {
    const byExpiry = new Map<string, typeof points>();
    points.forEach((p) => {
      const bucket = byExpiry.get(p.expiry) ?? [];
      bucket.push(p);
      byExpiry.set(p.expiry, bucket);
    });

    byExpiry.forEach((expiryPoints) => {
      const atm = expiryPoints.reduce((closest, p) =>
        Math.abs(p.k) < Math.abs(closest.k) ? p : closest,
      );
      const leftWing = expiryPoints[0];
      const rightWing = expiryPoints[expiryPoints.length - 1];

      // "Roughly" >= ATM: the hand-crafted sample data isn't a perfectly smooth
      // surface, so allow a small tolerance rather than requiring a strict inequality.
      const tolerance = 0.05;
      expect(leftWing.iv).toBeGreaterThanOrEqual(atm.iv - tolerance);
      expect(rightWing.iv).toBeGreaterThanOrEqual(atm.iv - tolerance);
    });
  });
});
