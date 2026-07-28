export type OptionType = 'call' | 'put';

export interface RawQuote {
  /** The traded asset or underlying symbol for this option. */
  underlying: string;
  /** The date the option prices were observed, in ISO 8601 format. */
  valuationDate: string;
  /** The expiry date of the option contract, in ISO 8601 format. */
  expiry: string;
  /** The strike price at which the option can be exercised. */
  strike: number;
  /** The option type: call for the right to buy, put for the right to sell. */
  type: OptionType;
  /** The best price someone is willing to buy the option for. */
  bid: number;
  /** The best price someone is willing to sell the option for. */
  ask: number;
  /** The current spot price of the underlying asset. */
  spot: number;
}

export interface OptionChain {
  /** The traded asset or underlying symbol for the option chain. */
  underlying: string;
  /** The date the option prices were observed, in ISO 8601 format. */
  valuationDate: string;
  /** The current spot price of the underlying asset. */
  spot: number;
  /** Normalised option quotes for this chain. */
  quotes: RawQuote[];
}

export interface CleanQuote extends RawQuote {
  /** The midpoint of bid and ask: (bid + ask) / 2. */
  mid: number;
  /** The absolute bid-ask spread: ask - bid. */
  spread: number;
  /** The spread as a fraction of the mid price: spread / mid. */
  relativeSpread: number;
  /** Liquidity-based weight for downstream fitting; larger for tighter markets. */
  weight: number;
}

export interface CleanConfig {
  /** Quotes with a relative spread above this fraction are dropped as too wide to trust. Default 0.5. */
  maxRelativeSpread: number;
  /** When true, quotes with a zero or negative bid are dropped outright. Default true. */
  dropZeroBid: boolean;
}

export type DropReason = 'zero-bid' | 'crossed' | 'wide-spread' | 'non-positive-price';

export interface CleanResult {
  /** Quotes that passed all cleaning checks, enriched with mid/spread/weight. */
  quotes: CleanQuote[];
  /** Quotes that were dropped, paired with the reason they failed cleaning. */
  dropped: Array<{ quote: RawQuote; reason: DropReason }>;
}
