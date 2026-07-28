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
