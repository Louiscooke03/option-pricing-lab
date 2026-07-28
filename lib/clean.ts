import { CleanConfig, CleanResult, DropReason, OptionChain, RawQuote } from './types';

const DEFAULT_CONFIG: CleanConfig = {
  maxRelativeSpread: 0.5,
  dropZeroBid: true,
};

// A spread of zero (or near it) would send an inverse-spread weight to infinity.
// Floor the spread used for weighting so the tightest quotes get a large but finite
// weight rather than dominating the fit completely.
const MIN_SPREAD_FOR_WEIGHT = 0.01;

export const midPrice = (bid: number, ask: number): number => (bid + ask) / 2;

export const spread = (bid: number, ask: number): number => ask - bid;

export const relativeSpread = (bid: number, ask: number): number => {
  const mid = midPrice(bid, ask);
  if (mid <= 0) {
    return Infinity;
  }
  return spread(bid, ask) / mid;
};

/**
 * Inverse-spread liquidity weight: tighter markets (smaller spread) are more
 * trustworthy and get a larger weight. This is a placeholder weighting scheme —
 * vega-based weighting is a planned refinement once implied vol exists, since
 * vega better reflects how much a quote actually constrains the fitted curve.
 */
export const liquidityWeight = (bid: number, ask: number): number => {
  const s = spread(bid, ask);
  return 1 / Math.max(s, MIN_SPREAD_FOR_WEIGHT);
};

export const cleanChain = (chain: OptionChain, config: Partial<CleanConfig> = {}): CleanResult => {
  const { maxRelativeSpread, dropZeroBid } = { ...DEFAULT_CONFIG, ...config };

  const quotes: CleanResult['quotes'] = [];
  const dropped: Array<{ quote: RawQuote; reason: DropReason }> = [];

  const drop = (quote: RawQuote, reason: DropReason) => {
    dropped.push({ quote, reason });
  };

  chain.quotes.forEach((quote) => {
    const { bid, ask } = quote;

    if (ask <= 0 || bid < 0) {
      drop(quote, 'non-positive-price');
      return;
    }

    if (bid > ask) {
      drop(quote, 'crossed');
      return;
    }

    if (dropZeroBid && bid <= 0) {
      drop(quote, 'zero-bid');
      return;
    }

    const rel = relativeSpread(bid, ask);

    if (rel > maxRelativeSpread) {
      drop(quote, 'wide-spread');
      return;
    }

    // TODO(M3): intrinsic-value lower-bound check once forward is known

    quotes.push({
      ...quote,
      mid: midPrice(bid, ask),
      spread: spread(bid, ask),
      relativeSpread: rel,
      weight: liquidityWeight(bid, ask),
    });
  });

  return { quotes, dropped };
};
