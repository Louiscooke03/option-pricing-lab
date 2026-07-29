import { describe, expect, it } from 'vitest';
import { black76Call, black76Put, black76Vega, normCdf, normPdf } from '../bs';

describe('normCdf', () => {
  it('matches known values to high accuracy', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normCdf(1)).toBeCloseTo(0.8413447460685429, 6);
    expect(normCdf(-1)).toBeCloseTo(0.15865525393145707, 6);
  });

  it('is symmetric around 0.5', () => {
    expect(normCdf(1.234) + normCdf(-1.234)).toBeCloseTo(1, 7);
  });
});

describe('normPdf', () => {
  it('peaks at 0 with the standard normal density value', () => {
    expect(normPdf(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 9);
  });
});

describe('black76Call / black76Put', () => {
  const F = 100;
  const K = 100;
  const tau = 1;
  const sigma = 0.2;
  const DF = 0.95;

  it('returns discounted intrinsic value when tau <= 0', () => {
    expect(black76Call(F, 90, 0, sigma, DF)).toBeCloseTo(DF * 10, 9);
    expect(black76Put(F, 110, 0, sigma, DF)).toBeCloseTo(DF * 10, 9);
  });

  it('returns discounted intrinsic value when sigma <= 0', () => {
    expect(black76Call(F, 90, tau, 0, DF)).toBeCloseTo(DF * 10, 9);
    expect(black76Put(F, 110, tau, 0, DF)).toBeCloseTo(DF * 10, 9);
  });

  it('satisfies put-call parity: C - P = DF * (F - K)', () => {
    const call = black76Call(F, K, tau, sigma, DF);
    const put = black76Put(F, K, tau, sigma, DF);
    expect(call - put).toBeCloseTo(DF * (F - K), 9);
  });

  it('produces positive prices for positive vol and time', () => {
    expect(black76Call(F, K, tau, sigma, DF)).toBeGreaterThan(0);
    expect(black76Put(F, K, tau, sigma, DF)).toBeGreaterThan(0);
  });
});

describe('black76Vega', () => {
  it('is positive for standard inputs', () => {
    expect(black76Vega(100, 100, 1, 0.2, 0.95)).toBeGreaterThan(0);
  });

  it('is zero when tau <= 0 or sigma <= 0', () => {
    expect(black76Vega(100, 100, 0, 0.2, 0.95)).toBe(0);
    expect(black76Vega(100, 100, 1, 0, 0.95)).toBe(0);
  });
});
