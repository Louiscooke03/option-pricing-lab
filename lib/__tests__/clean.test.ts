import { describe, expect, it } from 'vitest';
import { cleanChain, liquidityWeight, midPrice, relativeSpread, spread } from '../clean';
import { sampleChain } from '../sample/sampleChain';
import { RawQuote } from '../types';

const baseQuote: RawQuote = sampleChain.quotes[0];

describe('midPrice / spread / relativeSpread', () => {
  it('computes midPrice as the average of bid and ask', () => {
    expect(midPrice(9, 11)).toBe(10);
  });

  it('computes spread as ask minus bid', () => {
    expect(spread(9, 11)).toBe(2);
  });

  it('computes relativeSpread as spread over mid', () => {
    expect(relativeSpread(9, 11)).toBeCloseTo(2 / 10);
  });

  it('returns Infinity for relativeSpread when mid is non-positive', () => {
    expect(relativeSpread(0, 0)).toBe(Infinity);
  });
});

describe('liquidityWeight', () => {
  it('is larger for a tighter spread than a wider one', () => {
    const tight = liquidityWeight(9.9, 10.0);
    const wide = liquidityWeight(9.0, 10.0);
    expect(tight).toBeGreaterThan(wide);
  });

  it('is finite when the spread is ~0', () => {
    const w = liquidityWeight(10, 10);
    expect(Number.isFinite(w)).toBe(true);
  });
});

describe('cleanChain', () => {
  it('keeps all quotes from the well-formed sample chain', () => {
    const result = cleanChain(sampleChain);
    expect(result.quotes).toHaveLength(sampleChain.quotes.length);
    expect(result.dropped).toHaveLength(0);
  });

  it('gives every kept quote a positive weight', () => {
    const result = cleanChain(sampleChain);
    result.quotes.forEach((q) => {
      expect(q.weight).toBeGreaterThan(0);
    });
  });

  it('drops a zero-bid quote with reason zero-bid', () => {
    const chain = { ...sampleChain, quotes: [{ ...baseQuote, bid: 0, ask: 5 }] };
    const result = cleanChain(chain);
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped).toEqual([{ quote: chain.quotes[0], reason: 'zero-bid' }]);
  });

  it('drops a crossed quote (bid > ask) with reason crossed', () => {
    const chain = { ...sampleChain, quotes: [{ ...baseQuote, bid: 6, ask: 5 }] };
    const result = cleanChain(chain);
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped).toEqual([{ quote: chain.quotes[0], reason: 'crossed' }]);
  });

  it('drops a very wide spread quote with reason wide-spread', () => {
    const chain = { ...sampleChain, quotes: [{ ...baseQuote, bid: 1, ask: 10 }] };
    const result = cleanChain(chain);
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped).toEqual([{ quote: chain.quotes[0], reason: 'wide-spread' }]);
  });

  it('drops a non-positive ask quote with reason non-positive-price', () => {
    const chain = { ...sampleChain, quotes: [{ ...baseQuote, bid: 0, ask: 0 }] };
    const result = cleanChain(chain);
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped).toEqual([{ quote: chain.quotes[0], reason: 'non-positive-price' }]);
  });

  it('respects a custom maxRelativeSpread config', () => {
    const chain = { ...sampleChain, quotes: [{ ...baseQuote, bid: 9, ask: 11 }] };
    const result = cleanChain(chain, { maxRelativeSpread: 0.1 });
    expect(result.quotes).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('wide-spread');
  });
});
