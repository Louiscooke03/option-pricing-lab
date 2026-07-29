import { describe, expect, it } from 'vitest';
import { recoverForward, weightedLinearRegression } from '../forward';
import { yearFraction } from '../time';
import { cleanChain } from '../clean';
import { sampleChain } from '../sample/sampleChain';
import { CleanQuote, OptionType } from '../types';

describe('yearFraction', () => {
  it('computes ACT/365 fractions for known date pairs', () => {
    expect(yearFraction('2026-01-01', '2027-01-01')).toBeCloseTo(365 / 365);
    expect(yearFraction('2026-01-01', '2026-07-01')).toBeCloseTo(181 / 365);
    expect(yearFraction('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('weightedLinearRegression', () => {
  it('recovers slope and intercept of a clean synthetic line exactly', () => {
    const slope = 2.5;
    const intercept = -3;
    const points = [1, 2, 3, 4, 5].map((x) => ({ x, y: slope * x + intercept, w: 1 }));

    const result = weightedLinearRegression(points);

    expect(result.slope).toBeCloseTo(slope, 9);
    expect(result.intercept).toBeCloseTo(intercept, 9);
    expect(result.rSquared).toBeCloseTo(1, 9);
  });

  it('throws with fewer than 2 points', () => {
    expect(() => weightedLinearRegression([{ x: 1, y: 1, w: 1 }])).toThrow(/at least 2 points/);
  });

  it('throws when x has zero variance', () => {
    const points = [
      { x: 5, y: 1, w: 1 },
      { x: 5, y: 2, w: 1 },
    ];
    expect(() => weightedLinearRegression(points)).toThrow(/variance in x/);
  });
});

const makeQuote = (overrides: Partial<CleanQuote> & { strike: number; type: OptionType; mid: number }): CleanQuote => ({
  underlying: 'SYN',
  valuationDate: '2026-01-01',
  expiry: '2026-07-01',
  bid: overrides.mid - 0.01,
  ask: overrides.mid + 0.01,
  spot: 100,
  spread: 0.02,
  relativeSpread: 0.02 / overrides.mid,
  weight: 1,
  ...overrides,
});

describe('recoverForward: synthetic round-trip', () => {
  it('recovers a known forward and discount factor from parity-consistent quotes', () => {
    const knownForward = 105;
    const knownDiscountFactor = 0.97;
    const strikes = [80, 90, 95, 100, 105, 110, 120];

    const quotes: CleanQuote[] = strikes.flatMap((strike) => {
      // C - P = DF * (F - K); hold the put mid at a constant base and let the call
      // mid carry the parity difference, so the relation is satisfied exactly.
      const parity = knownDiscountFactor * (knownForward - strike);
      const put = 20;
      const call = put + parity;

      return [
        makeQuote({ strike, type: 'call', mid: call }),
        makeQuote({ strike, type: 'put', mid: put }),
      ];
    });

    const result = recoverForward(quotes, '2026-01-01');

    expect(result.skipped).toHaveLength(0);
    expect(result.expiries).toHaveLength(1);

    const [recovered] = result.expiries;
    expect(recovered.forward).toBeCloseTo(knownForward, 9);
    expect(recovered.discountFactor).toBeCloseTo(knownDiscountFactor, 9);
    expect(recovered.nStrikes).toBe(strikes.length);
    expect(recovered.rSquared).toBeCloseTo(1, 9);
  });
});

describe('recoverForward: sample chain', () => {
  it('returns one ExpiryForward per expiry with plausible values', () => {
    const cleaned = cleanChain(sampleChain);
    const result = recoverForward(cleaned.quotes, sampleChain.valuationDate);

    const expiries = [...new Set(sampleChain.quotes.map((q) => q.expiry))];
    expect(result.expiries).toHaveLength(expiries.length);

    let previousTau = -Infinity;
    result.expiries.forEach((ef) => {
      expect(ef.forward).toBeGreaterThan(sampleChain.spot * 0.8);
      expect(ef.forward).toBeLessThan(sampleChain.spot * 1.2);
      expect(ef.discountFactor).toBeGreaterThan(0);
      // The bundled sample chain is hand-crafted and not perfectly parity-consistent,
      // so allow some margin above 1 rather than requiring a strictly sub-1 discount factor.
      expect(ef.discountFactor).toBeLessThan(1.2);
      expect(ef.tau).toBeGreaterThan(previousTau);
      expect(ef.rSquared).toBeGreaterThan(0.99);
      previousTau = ef.tau;
    });
  });
});

describe('recoverForward: skipped expiries', () => {
  it('skips an expiry with only one paired strike', () => {
    const quotes: CleanQuote[] = [
      makeQuote({ strike: 100, type: 'call', mid: 10, expiry: '2026-07-01' }),
      makeQuote({ strike: 100, type: 'put', mid: 5, expiry: '2026-07-01' }),
    ];

    const result = recoverForward(quotes, '2026-01-01');

    expect(result.expiries).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].expiry).toBe('2026-07-01');
    expect(result.skipped[0].reason).toMatch(/fewer than 2 paired strikes/);
  });
});
