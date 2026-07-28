import { OptionChain, OptionType, RawQuote } from '../types';

const expectedHeaders = [
  'underlying',
  'valuationDate',
  'expiry',
  'strike',
  'type',
  'bid',
  'ask',
  'spot',
] as const;

const optionTypes: readonly OptionType[] = ['call', 'put'];

const normalizeHeader = (header: string): string => header.trim().toLowerCase();

const parseStringField = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  throw new Error(`Missing or invalid ${field}; expected a non-empty string`);
};

const parseNumberField = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Invalid ${field}; expected a numeric value`);
};

const parseOptionType = (value: unknown, field: string): OptionType => {
  const normalized = parseStringField(value, field).toLowerCase();
  if (optionTypes.includes(normalized as OptionType)) {
    return normalized as OptionType;
  }
  throw new Error(`Invalid ${field}; expected call or put, got "${value}"`);
};

const parseDateString = (value: unknown, field: string): string => {
  const candidate = parseStringField(value, field);
  if (Number.isNaN(Date.parse(candidate))) {
    throw new Error(`Invalid ${field}; expected ISO date, got "${candidate}"`);
  }
  return candidate;
};

const parseQuoteObject = (raw: unknown, index: number): RawQuote => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Bad row at index ${index}: expected object`);
  }

  const quote = raw as Record<string, unknown>;

  return {
    underlying: parseStringField(quote.underlying, 'underlying'),
    valuationDate: parseDateString(quote.valuationDate, 'valuationDate'),
    expiry: parseDateString(quote.expiry, 'expiry'),
    strike: parseNumberField(quote.strike, 'strike'),
    type: parseOptionType(quote.type, 'type'),
    bid: parseNumberField(quote.bid, 'bid'),
    ask: parseNumberField(quote.ask, 'ask'),
    spot: parseNumberField(quote.spot, 'spot'),
  };
};

export const validateChain = (chain: OptionChain): OptionChain => {
  if (typeof chain.underlying !== 'string' || chain.underlying.trim() === '') {
    throw new Error('Invalid option chain: underlying must be a non-empty string');
  }

  if (typeof chain.valuationDate !== 'string' || Number.isNaN(Date.parse(chain.valuationDate))) {
    throw new Error('Invalid option chain: valuationDate must be a valid ISO date');
  }

  if (typeof chain.spot !== 'number' || !Number.isFinite(chain.spot) || chain.spot <= 0) {
    throw new Error('Invalid option chain: spot must be a positive number');
  }

  if (!Array.isArray(chain.quotes) || chain.quotes.length === 0) {
    throw new Error('Invalid option chain: must contain at least one quote');
  }

  const valuationTime = Date.parse(chain.valuationDate);

  if (Number.isNaN(valuationTime)) {
    throw new Error(`Invalid option chain: valuationDate "${chain.valuationDate}" is not a valid date`);
  }

  chain.quotes.forEach((quote, index) => {
    const rowNumber = index + 1;

    if (quote.underlying !== chain.underlying) {
      throw new Error(`Invalid quote at row ${rowNumber}: underlying "${quote.underlying}" does not match chain underlying "${chain.underlying}"`);
    }

    if (quote.valuationDate !== chain.valuationDate) {
      throw new Error(`Invalid quote at row ${rowNumber}: valuationDate "${quote.valuationDate}" does not match chain valuationDate "${chain.valuationDate}"`);
    }

    if (typeof quote.expiry !== 'string' || Number.isNaN(Date.parse(quote.expiry))) {
      throw new Error(`Invalid quote at row ${rowNumber}: expiry must be a valid ISO date`);
    }

    if (Date.parse(quote.expiry) < valuationTime) {
      throw new Error(`Invalid quote at row ${rowNumber}: expiry ${quote.expiry} must be on or after valuationDate ${chain.valuationDate}`);
    }

    if (typeof quote.strike !== 'number' || !Number.isFinite(quote.strike) || quote.strike <= 0) {
      throw new Error(`Invalid quote at row ${rowNumber}: strike must be a positive number`);
    }

    if (typeof quote.spot !== 'number' || !Number.isFinite(quote.spot) || quote.spot <= 0) {
      throw new Error(`Invalid quote at row ${rowNumber}: spot must be a positive number`);
    }

    if (quote.bid > quote.ask) {
      throw new Error(`Invalid quote at row ${rowNumber}: bid ${quote.bid} is greater than ask ${quote.ask}`);
    }

    if (!optionTypes.includes(quote.type)) {
      throw new Error(`Invalid quote at row ${rowNumber}: unknown option type "${quote.type}"`);
    }
  });

  return chain;
};

const splitFields = (line: string, delimiter: string | RegExp): string[] => {
  if (delimiter === ',') {
    return line.split(',').map((value) => value.trim());
  }

  return line
    .trim()
    .split(delimiter)
    .map((value) => value.trim())
    .filter((value) => value !== '');
};

const getHeaderIndex = (header: string[]): Record<string, number> => {
  return header.reduce<Record<string, number>>((map, column, index) => {
    map[normalizeHeader(column)] = index;
    return map;
  }, {});
};

const buildQuoteFromCells = (cells: string[], headerIndex: Record<string, number>, rowIndex: number): RawQuote => {
  const row: Record<string, unknown> = {};

  expectedHeaders.forEach((field) => {
    const index = headerIndex[normalizeHeader(field)];
    if (index === undefined) {
      throw new Error(`Missing required column: ${field}`);
    }
    row[field] = cells[index] ?? '';
  });

  return parseQuoteObject(row, rowIndex);
};

const parseDelimitedTable = (text: string, delimiter: string | RegExp): OptionChain => {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length < 2) {
    throw new Error('Invalid table: must include header and at least one data row');
  }

  const headerCells = splitFields(lines[0], delimiter);
  const headerIndex = getHeaderIndex(headerCells);

  const quotes = lines.slice(1).map((line, rowIndex) => {
    const cells = splitFields(line, delimiter);
    return buildQuoteFromCells(cells, headerIndex, rowIndex + 1);
  });

  const first = quotes[0];
  return validateChain({
    underlying: first.underlying,
    valuationDate: first.valuationDate,
    spot: first.spot,
    quotes,
  });
};

export const fromJSON = (input: string | unknown): OptionChain => {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid JSON payload: expected object');
  }

  const raw = payload as Record<string, unknown>;

  if (!Array.isArray(raw.quotes)) {
    throw new Error('Invalid JSON payload: missing quotes array');
  }

  const quotes = raw.quotes.map((quote, index) => parseQuoteObject(quote, index + 1));
  const underlying = raw.underlying ?? quotes[0]?.underlying;
  const valuationDate = raw.valuationDate ?? quotes[0]?.valuationDate;
  const spot = raw.spot ?? quotes[0]?.spot;

  return validateChain({
    underlying: parseStringField(underlying, 'underlying'),
    valuationDate: parseDateString(valuationDate, 'valuationDate'),
    spot: parseNumberField(spot, 'spot'),
    quotes,
  });
};

export const fromCSV = (csv: string): OptionChain => {
  return parseDelimitedTable(csv, ',');
};

export const fromPaste = (text: string): OptionChain => {
  const candidate = text.trim();
  if (candidate.includes(',')) {
    return fromCSV(text);
  }

  const delimiter = candidate.includes('\t') ? /\t/ : /\s+/;
  return parseDelimitedTable(text, delimiter);
};
