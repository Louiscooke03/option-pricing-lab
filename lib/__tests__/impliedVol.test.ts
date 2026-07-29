import { describe, expect, it } from 'vitest';
import { black76Call, black76Put } from '../bs';
import { impliedVol } from '../impliedVol';

describe('impliedVol: round-trip', () => {
  const F = 100;
  const tau = 0.5;
  const DF = 0.97;
  const sigma = 0.25;

  const strikes: Array<{ label: string; K: number }> = [
    { label: 'ATM', K: 100 },
    { label: 'ITM call / OTM put', K: 85 },
    { label: 'OTM call / ITM put', K: 120 },
  ];

  strikes.forEach(({ label, K }) => {
    it(`recovers sigma for a call at ${label} (K=${K})`, () => {
      const price = black76Call(F, K, tau, sigma, DF);
      const recovered = impliedVol(price, F, K, tau, DF, true);
      expect(recovered).not.toBeNull();
      expect(recovered as number).toBeCloseTo(sigma, 7);
    });

    it(`recovers sigma for a put at ${label} (K=${K})`, () => {
      const price = black76Put(F, K, tau, sigma, DF);
      const recovered = impliedVol(price, F, K, tau, DF, false);
      expect(recovered).not.toBeNull();
      expect(recovered as number).toBeCloseTo(sigma, 7);
    });
  });
});

describe('impliedVol: no-arbitrage bound rejection', () => {
  const F = 100;
  const K = 100;
  const tau = 0.5;
  const DF = 0.97;

  it('returns null for a call price at or below intrinsic', () => {
    const lowerBound = DF * Math.max(F - K, 0);
    expect(impliedVol(lowerBound, F, K, tau, DF, true)).toBeNull();
    expect(impliedVol(lowerBound - 1, F, K, tau, DF, true)).toBeNull();
  });

  it('returns null for a call price at or above the DF*F upper bound', () => {
    const upperBound = DF * F;
    expect(impliedVol(upperBound, F, K, tau, DF, true)).toBeNull();
    expect(impliedVol(upperBound + 1, F, K, tau, DF, true)).toBeNull();
  });

  it('returns null for a put price outside its no-arbitrage bounds', () => {
    const lowerBound = DF * Math.max(K - F, 0);
    const upperBound = DF * K;
    expect(impliedVol(lowerBound, F, K, tau, DF, false)).toBeNull();
    expect(impliedVol(upperBound, F, K, tau, DF, false)).toBeNull();
  });
});
