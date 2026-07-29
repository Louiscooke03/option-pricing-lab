import { CleanQuote, ExpiryForward, ForwardResult } from './types';
import { yearFraction } from './time';

export interface RegressionPoint {
  x: number;
  y: number;
  w: number;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

/**
 * Weighted least squares regression of y on x: minimises sum(w * (y - (slope*x + intercept))^2).
 */
export const weightedLinearRegression = (points: RegressionPoint[]): RegressionResult => {
  if (points.length < 2) {
    throw new Error(`weightedLinearRegression requires at least 2 points, got ${points.length}`);
  }

  const sw = points.reduce((acc, p) => acc + p.w, 0);
  const sx = points.reduce((acc, p) => acc + p.w * p.x, 0);
  const sy = points.reduce((acc, p) => acc + p.w * p.y, 0);
  const sxx = points.reduce((acc, p) => acc + p.w * p.x * p.x, 0);
  const sxy = points.reduce((acc, p) => acc + p.w * p.x * p.y, 0);

  const denominator = sw * sxx - sx * sx;
  if (denominator === 0) {
    throw new Error('weightedLinearRegression requires variance in x, got a degenerate (constant) input');
  }

  const slope = (sw * sxy - sx * sy) / denominator;
  const intercept = (sy - slope * sx) / sw;

  const yMean = sy / sw;
  const ssTot = points.reduce((acc, p) => acc + p.w * (p.y - yMean) ** 2, 0);
  const ssRes = points.reduce((acc, p) => acc + p.w * (p.y - (slope * p.x + intercept)) ** 2, 0);
  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
};

const groupByExpiry = (quotes: CleanQuote[]): Map<string, CleanQuote[]> => {
  const groups = new Map<string, CleanQuote[]>();
  quotes.forEach((quote) => {
    const group = groups.get(quote.expiry);
    if (group) {
      group.push(quote);
    } else {
      groups.set(quote.expiry, [quote]);
    }
  });
  return groups;
};

const buildParityPoints = (quotes: CleanQuote[]): RegressionPoint[] => {
  const calls = new Map<number, CleanQuote>();
  const puts = new Map<number, CleanQuote>();

  quotes.forEach((quote) => {
    const bucket = quote.type === 'call' ? calls : puts;
    bucket.set(quote.strike, quote);
  });

  const points: RegressionPoint[] = [];
  calls.forEach((call, strike) => {
    const put = puts.get(strike);
    if (put) {
      points.push({ x: strike, y: call.mid - put.mid, w: Math.min(call.weight, put.weight) });
    }
  });

  return points;
};

/**
 * Recovers, per expiry, the implied forward and discount factor via put-call parity:
 * C - P = DF * (F - K), i.e. a linear regression of (call.mid - put.mid) on strike
 * with slope = -DF and intercept = DF * F.
 */
export const recoverForward = (quotes: CleanQuote[], valuationDate: string): ForwardResult => {
  const groups = groupByExpiry(quotes);
  const expiries: ExpiryForward[] = [];
  const skipped: Array<{ expiry: string; reason: string }> = [];

  groups.forEach((expiryQuotes, expiry) => {
    const points = buildParityPoints(expiryQuotes);

    if (points.length < 2) {
      skipped.push({ expiry, reason: `fewer than 2 paired strikes (found ${points.length})` });
      return;
    }

    let regression: RegressionResult;
    try {
      regression = weightedLinearRegression(points);
    } catch (error) {
      skipped.push({ expiry, reason: `degenerate parity fit: ${(error as Error).message}` });
      return;
    }

    const discountFactor = -regression.slope;
    const forward = regression.intercept / discountFactor;

    if (discountFactor <= 0 || discountFactor > 1.5 || forward <= 0) {
      skipped.push({ expiry, reason: 'bad or degenerate fit: implausible discount factor or forward' });
      return;
    }

    expiries.push({
      expiry,
      tau: yearFraction(valuationDate, expiry),
      forward,
      discountFactor,
      nStrikes: points.length,
      rSquared: regression.rSquared,
    });
  });

  expiries.sort((a, b) => a.tau - b.tau);

  return { expiries, skipped };
};
