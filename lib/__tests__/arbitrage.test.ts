import { describe, expect, it } from 'vitest';
import {
  sviDerivatives,
  riskNeutralDensity,
  checkButterfly,
  checkCalendar,
  CalendarSlice,
} from '../arbitrage';
import { sviTotalVariance, fitSVISlice, SVIParams, SVIPoint } from '../svi';
import { cleanChain } from '../clean';
import { recoverForward } from '../forward';
import { impliedVolPoints } from '../volSurface';
import { sampleChain } from '../sample/sampleChain';

const BENIGN_PARAMS: SVIParams = { a: 0.02, b: 0.15, rho: -0.3, m: -0.05, sigma: 0.2 };

// Excessive skew: large b, |rho| near 1, tiny sigma -> a sharp, near-kinked wing that
// drives the butterfly indicator negative somewhere in the smile.
const PATHOLOGICAL_PARAMS: SVIParams = { a: 0.01, b: 4, rho: -0.999, m: 0, sigma: 0.005 };

describe('sviDerivatives', () => {
  it('matches central finite differences of sviTotalVariance to ~1e-6', () => {
    const h = 1e-5;
    const ks = [-1.2, -0.5, -0.1, 0, 0.1, 0.5, 1.2];

    ks.forEach((k) => {
      const { wp, wpp } = sviDerivatives(k, BENIGN_PARAMS);

      const wPlus = sviTotalVariance(k + h, BENIGN_PARAMS);
      const wMinus = sviTotalVariance(k - h, BENIGN_PARAMS);
      const w0 = sviTotalVariance(k, BENIGN_PARAMS);

      const fdWp = (wPlus - wMinus) / (2 * h);
      const fdWpp = (wPlus - 2 * w0 + wMinus) / (h * h);

      expect(wp).toBeCloseTo(fdWp, 5);
      expect(wpp).toBeCloseTo(fdWpp, 3);
    });
  });
});

describe('checkButterfly', () => {
  it('passes (ok=true, minG>0) for a benign SVI slice', () => {
    const result = checkButterfly(BENIGN_PARAMS);
    expect(result.ok).toBe(true);
    expect(result.minG).toBeGreaterThan(0);
    expect(result.violations).toHaveLength(0);
  });

  it('the implied density integrates to ~1 over a wide k-grid', () => {
    const lo = -8;
    const hi = 8;
    const n = 4000;
    const step = (hi - lo) / n;
    const kGrid = Array.from({ length: n + 1 }, (_, i) => lo + i * step);

    const densities = kGrid.map((k) => riskNeutralDensity(k, BENIGN_PARAMS));

    // Trapezoidal rule.
    let integral = 0;
    for (let i = 0; i < densities.length - 1; i += 1) {
      integral += ((densities[i] + densities[i + 1]) / 2) * step;
    }

    expect(integral).toBeGreaterThan(0.95);
    expect(integral).toBeLessThan(1.05);
  });

  it('detects g<0 violations for a pathological, excessively skewed SVI slice', () => {
    const result = checkButterfly(PATHOLOGICAL_PARAMS);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.minG).toBeLessThan(0);
  });
});

describe('checkCalendar', () => {
  it('passes for two nested, non-crossing slices', () => {
    const short: CalendarSlice = { tau: 0.1, params: { a: 0.01, b: 0.1, rho: -0.2, m: 0, sigma: 0.2 } };
    const long: CalendarSlice = { tau: 0.5, params: { a: 0.05, b: 0.15, rho: -0.2, m: 0, sigma: 0.25 } };

    const result = checkCalendar([short, long]);
    expect(result.ok).toBe(true);
    expect(result.crossings).toHaveLength(0);
  });

  it('flags a crossing at the right k when a longer expiry dips below a shorter one', () => {
    // Deliberately construct params so the "long" slice's total variance is lower than
    // the "short" slice's near k=0, but not necessarily everywhere.
    const short: CalendarSlice = { tau: 0.1, params: { a: 0.05, b: 0.05, rho: 0, m: 0, sigma: 0.2 } };
    const long: CalendarSlice = { tau: 0.5, params: { a: 0.01, b: 0.05, rho: 0, m: 0, sigma: 0.2 } };

    const result = checkCalendar([short, long], [0]);
    expect(result.ok).toBe(false);
    expect(result.crossings).toHaveLength(1);
    expect(result.crossings[0].k).toBe(0);
    expect(result.crossings[0].tauShort).toBe(0.1);
    expect(result.crossings[0].tauLong).toBe(0.5);
  });
});

describe('arbitrage checks wired to the real sampleChain pipeline', () => {
  const cleaned = cleanChain(sampleChain);
  const { expiries } = recoverForward(cleaned.quotes, sampleChain.valuationDate);
  const { points } = impliedVolPoints(cleaned.quotes, expiries);

  const byExpiry = new Map<string, SVIPoint[]>();
  points.forEach((p) => {
    const bucket = byExpiry.get(p.expiry) ?? [];
    bucket.push({ k: p.k, w: p.totalVar, weight: p.weight });
    byExpiry.set(p.expiry, bucket);
  });

  // Arbitrage checks are only meaningful within the region the fit is actually
  // calibrated against; an SVI slice's extrapolation far outside its own observed
  // strikes (the default [-1.5, 1.5] grid) is not a claim this fit is making. So,
  // as in the Python research layer, each check below uses a k-grid restricted to
  // the data-supported range rather than the library's wide default.
  const slices: (CalendarSlice & { kMin: number; kMax: number })[] = [];
  byExpiry.forEach((slicePoints, expiry) => {
    const tau = expiries.find((e) => e.expiry === expiry)?.tau;
    if (tau === undefined) return;
    const fit = fitSVISlice(slicePoints);
    const ks = slicePoints.map((p) => p.k);
    slices.push({ tau, params: fit.params, kMin: Math.min(...ks), kMax: Math.max(...ks) });
  });

  const gridBetween = (lo: number, hi: number, step = 0.01): number[] => {
    const n = Math.max(Math.round((hi - lo) / step), 1);
    return Array.from({ length: n + 1 }, (_, i) => lo + (i / n) * (hi - lo));
  };

  it('passes checkButterfly for every fitted expiry slice, within its own observed strike range', () => {
    expect(slices.length).toBeGreaterThan(0);
    slices.forEach((slice) => {
      const pad = (slice.kMax - slice.kMin) * 0.15 || 0.05;
      const kGrid = gridBetween(slice.kMin - pad, slice.kMax + pad);
      const result = checkButterfly(slice.params, kGrid);
      expect(result.ok, `tau=${slice.tau} minG=${result.minG}`).toBe(true);
    });
  });

  it('passes checkCalendar across all fitted expiry slices, over their shared observed range', () => {
    const kLo = Math.max(...slices.map((s) => s.kMin));
    const kHi = Math.min(...slices.map((s) => s.kMax));
    const kGrid = gridBetween(kLo, kHi);

    const result = checkCalendar(slices, kGrid);
    expect(result.ok, `crossings: ${JSON.stringify(result.crossings)}`).toBe(true);
  });
});
