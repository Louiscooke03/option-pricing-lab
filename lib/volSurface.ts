import { impliedVol } from './impliedVol';
import { CleanQuote, ExpiryForward, VolPoint } from './types';

export interface VolPointsResult {
  points: VolPoint[];
  skipped: Array<{ expiry: string; strike: number; reason: string }>;
}

interface StrikeQuotes {
  call?: CleanQuote;
  put?: CleanQuote;
}

const groupByStrike = (quotes: CleanQuote[]): Map<number, StrikeQuotes> => {
  const byStrike = new Map<number, StrikeQuotes>();
  quotes.forEach((quote) => {
    const entry = byStrike.get(quote.strike) ?? {};
    entry[quote.type] = quote;
    byStrike.set(quote.strike, entry);
  });
  return byStrike;
};

/**
 * For each expiry with a recovered forward, inverts the OTM leg at each strike to
 * implied volatility and maps it into (log-moneyness, total variance) coordinates.
 */
export const impliedVolPoints = (quotesByExpiry: CleanQuote[], forwards: ExpiryForward[]): VolPointsResult => {
  const points: VolPoint[] = [];
  const skipped: Array<{ expiry: string; strike: number; reason: string }> = [];

  forwards.forEach(({ expiry, tau, forward: F, discountFactor: DF }) => {
    const expiryQuotes = quotesByExpiry.filter((quote) => quote.expiry === expiry);
    const byStrike = groupByStrike(expiryQuotes);
    const strikes = [...byStrike.keys()].sort((a, b) => a - b);

    strikes.forEach((strike) => {
      const isCall = strike > F;
      const quote = byStrike.get(strike)?.[isCall ? 'call' : 'put'];

      if (!quote) {
        skipped.push({ expiry, strike, reason: `missing ${isCall ? 'call' : 'put'} (OTM) quote` });
        return;
      }

      const iv = impliedVol(quote.mid, F, strike, tau, DF, isCall);

      if (iv === null) {
        skipped.push({ expiry, strike, reason: 'implied vol did not converge or price violates no-arbitrage bounds' });
        return;
      }

      points.push({
        expiry,
        tau,
        strike,
        forward: F,
        k: Math.log(strike / F),
        iv,
        totalVar: iv * iv * tau,
        weight: quote.weight,
      });
    });
  });

  points.sort((a, b) => (a.tau === b.tau ? a.k - b.k : a.tau - b.tau));

  return { points, skipped };
};
