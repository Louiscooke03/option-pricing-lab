import { describe, expect, it } from 'vitest';
import { fromCSV, fromJSON, fromPaste, validateChain } from '../index';
import { sampleChain, sampleChainCSV } from '../../sample/sampleChain';

describe('adapters', () => {
  it('parses sample chain from CSV', () => {
    expect(fromCSV(sampleChainCSV)).toEqual(sampleChain);
  });

  it('parses sample chain from JSON input', () => {
    expect(fromJSON(sampleChain)).toEqual(sampleChain);
  });

  it('parses comma-separated pasted text', () => {
    expect(fromPaste(sampleChainCSV)).toEqual(sampleChain);
  });

  it('parses tab-separated pasted text', () => {
    const tabText = sampleChainCSV.replace(/,/g, '\t');
    expect(fromPaste(tabText)).toEqual(sampleChain);
  });

  it('rejects an empty quote list', () => {
    expect(() => validateChain({ ...sampleChain, quotes: [] })).toThrow(/must contain at least one quote/);
  });

  it('rejects a negative strike', () => {
    const invalid = {
      ...sampleChain,
      quotes: [{ ...sampleChain.quotes[0], strike: -1 }],
    };
    expect(() => validateChain(invalid)).toThrow(/strike must be a positive number/);
  });

  it('rejects a bid greater than ask', () => {
    const invalid = {
      ...sampleChain,
      quotes: [{ ...sampleChain.quotes[0], bid: 10, ask: 9 }],
    };
    expect(() => validateChain(invalid)).toThrow(/bid 10 is greater than ask 9/);
  });

  it('rejects an expiry before valuationDate', () => {
    const invalid = {
      ...sampleChain,
      quotes: [{ ...sampleChain.quotes[0], expiry: '2026-07-01' }],
    };
    expect(() => validateChain(invalid)).toThrow(/expiry 2026-07-01 must be on or after valuationDate 2026-07-28/);
  });

  it('rejects an unknown option type', () => {
    const invalid = {
      ...sampleChain,
      quotes: [
        {
          ...sampleChain.quotes[0],
          type: 'unknown' as unknown as (typeof sampleChain.quotes)[0]['type'],
        },
      ],
    };
    expect(() => validateChain(invalid)).toThrow(/unknown option type/);
  });
});
