import { describe, expect, it } from 'vitest';
import {
  ssviTotalVariance,
  thetaOf,
  buildThetaTermStructure,
  fitSSVI,
  ssviSliceToSVIParams,
  SSVIParams,
  ThetaKnot,
  SSVIPointsGroup,
} from '../ssvi';
import { fitSVISlice, SVIPoint } from '../svi';
import { checkButterfly, checkCalendar } from '../arbitrage';
import { cleanChain } from '../clean';
import { recoverForward } from '../forward';
import { impliedVolPoints } from '../volSurface';
import { sampleChain } from '../sample/sampleChain';

const TRUE_SSVI: SSVIParams = { rho: -0.35, eta: 1.2, gamma: 0.3 };
const TRUE_KNOTS: ThetaKnot[] = [
  { tau: 0.05, theta: 0.015 },
  { tau: 0.1, theta: 0.025 },
  { tau: 0.25, theta: 0.045 },
  { tau: 0.5, theta: 0.07 },
  { tau: 1.0, theta: 0.11 },
];

describe('thetaOf', () => {
  it('passes through every knot exactly and clamps outside the range', () => {
    TRUE_KNOTS.forEach(({ tau, theta }) => {
      expect(thetaOf(tau, TRUE_KNOTS)).toBeCloseTo(theta, 10);
    });
    expect(thetaOf(0.01, TRUE_KNOTS)).toBeCloseTo(0.015, 10); // below range: clamped
    expect(thetaOf(5, TRUE_KNOTS)).toBeCloseTo(0.11, 10); // above range: clamped
  });

  it('stays between neighbouring knot values (monotone, non-overshooting)', () => {
    const mid = thetaOf(0.075, TRUE_KNOTS); // halfway between tau=0.05 and tau=0.1
    expect(mid).toBeGreaterThan(0.015);
    expect(mid).toBeLessThan(0.025);
  });

  it('is non-decreasing on a fine tau grid spanning the knots', () => {
    const grid = Array.from({ length: 400 }, (_, i) => 0.01 + (i / 399) * (1.2 - 0.01));
    let prev = -Infinity;
    grid.forEach((tau) => {
      const theta = thetaOf(tau, TRUE_KNOTS);
      expect(theta).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = theta;
    });
  });

  it('is C1: the finite-difference derivative has no jump across an interior knot', () => {
    // TRUE_KNOTS[2] = { tau: 0.25, theta: 0.045 } is an interior knot with different
    // secant slopes on either side, exactly the shape that produces a slope kink
    // (and hence a step in the Dupire dw/dtau) under piecewise-linear interpolation.
    const knotTau = TRUE_KNOTS[2].tau;
    const h = 1e-4;

    const derivativeAt = (tau: number): number =>
      (thetaOf(tau + h, TRUE_KNOTS) - thetaOf(tau - h, TRUE_KNOTS)) / (2 * h);

    const derivBefore = derivativeAt(knotTau - 10 * h);
    const derivAfter = derivativeAt(knotTau + 10 * h);

    expect(derivAfter).toBeCloseTo(derivBefore, 2);
  });
});

describe('buildThetaTermStructure', () => {
  it('is non-decreasing in tau, clamping any dip up to the previous knot', () => {
    const sliceFits = [
      { tau: 0.5, params: { a: 0.06, b: 0.1, rho: -0.2, m: 0, sigma: 0.2 } },
      { tau: 0.1, params: { a: 0.01, b: 0.05, rho: -0.2, m: 0, sigma: 0.2 } },
      // Deliberately given a lower ATM level than the tau=0.1 slice, to exercise clamping.
      { tau: 0.25, params: { a: 0.001, b: 0.01, rho: -0.2, m: 0, sigma: 0.2 } },
    ];

    const knots = buildThetaTermStructure(sliceFits);

    expect(knots.map((k) => k.tau)).toEqual([0.1, 0.25, 0.5]);
    for (let i = 1; i < knots.length; i += 1) {
      expect(knots[i].theta).toBeGreaterThanOrEqual(knots[i - 1].theta);
    }
  });
});

describe('fitSSVI: synthetic recovery', () => {
  it('recovers the true w(k, tau) surface to a small tolerance despite tiny noise', () => {
    const groups: SSVIPointsGroup[] = TRUE_KNOTS.map(({ tau, theta }) => {
      const ks = Array.from({ length: 15 }, (_, i) => -1 + (i / 14) * 2);
      const points: SVIPoint[] = ks.map((k, i) => {
        const noise = Math.sin((i + tau * 100) * 12.9898) * 1e-6;
        return { k, w: ssviTotalVariance(k, theta, TRUE_SSVI) + noise, weight: 1 };
      });
      return { tau, points };
    });

    const fit = fitSSVI(groups, TRUE_KNOTS);

    expect(fit.converged).toBe(true);
    expect(fit.rmse).toBeLessThan(1e-3);

    const kGrid = Array.from({ length: 21 }, (_, i) => -1 + (i / 20) * 2);
    TRUE_KNOTS.forEach(({ tau, theta }) => {
      kGrid.forEach((k) => {
        const trueW = ssviTotalVariance(k, theta, TRUE_SSVI);
        const fittedW = ssviTotalVariance(k, theta, fit.params);
        expect(fittedW).toBeCloseTo(trueW, 3);
      });
      void tau;
    });
  });
});

describe('fitSSVI: bundled sample chain pipeline', () => {
  const cleaned = cleanChain(sampleChain);
  const { expiries } = recoverForward(cleaned.quotes, sampleChain.valuationDate);
  const { points } = impliedVolPoints(cleaned.quotes, expiries);

  const byExpiry = new Map<string, SVIPoint[]>();
  points.forEach((p) => {
    const bucket = byExpiry.get(p.expiry) ?? [];
    bucket.push({ k: p.k, w: p.totalVar, weight: p.weight });
    byExpiry.set(p.expiry, bucket);
  });

  const sliceFits: { tau: number; params: ReturnType<typeof fitSVISlice>['params'] }[] = [];
  const groups: SSVIPointsGroup[] = [];
  byExpiry.forEach((slicePoints, expiry) => {
    const tau = expiries.find((e) => e.expiry === expiry)?.tau;
    if (tau === undefined) return;
    const fit = fitSVISlice(slicePoints);
    sliceFits.push({ tau, params: fit.params });
    groups.push({ tau, points: slicePoints });
  });

  const thetaKnots = buildThetaTermStructure(sliceFits);

  it('theta term structure is non-decreasing in tau', () => {
    expect(thetaKnots.length).toBeGreaterThan(0);
    for (let i = 1; i < thetaKnots.length; i += 1) {
      expect(thetaKnots[i].theta).toBeGreaterThanOrEqual(thetaKnots[i - 1].theta);
    }
  });

  it('fits one global SSVI surface across all expiries with a reasonable rmse', () => {
    const fit = fitSSVI(groups, thetaKnots);
    expect(fit.converged).toBe(true);
    expect(fit.rmse).toBeLessThan(0.05);
  });

  it('the fitted surface passes checkButterfly and checkCalendar at every fitted expiry', () => {
    const fit = fitSSVI(groups, thetaKnots);

    const slices = thetaKnots.map(({ tau, theta }) => ({
      tau,
      params: ssviSliceToSVIParams(theta, fit.params),
    }));

    slices.forEach((slice) => {
      const result = checkButterfly(slice.params);
      expect(result.ok, `tau=${slice.tau} minG=${result.minG}`).toBe(true);
    });

    const calendarResult = checkCalendar(slices);
    expect(calendarResult.ok, `crossings: ${JSON.stringify(calendarResult.crossings)}`).toBe(true);
  });
});
