import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMIT, MAX_LIMIT, PAGINATION_MESSAGES, paginationSchema } from '../src/index';

const refused = (input: unknown): string => {
  const result = paginationSchema.safeParse(input);
  expect(result.success, `expected ${JSON.stringify(input)} to be refused`).toBe(false);
  if (result.success) throw new Error('unreachable');
  return result.error.issues[0]?.message ?? '';
};

describe('how many records a page holds', () => {
  it('gives fifty records when no page size is asked for', () => {
    const result = paginationSchema.parse({});
    expect(result.limit).toBe(DEFAULT_LIMIT);
  });

  it('gives the number asked for when it is within the allowed range', () => {
    expect(paginationSchema.parse({ limit: 25 }).limit).toBe(25);
  });

  it('reduces a request for one hundred and one records to one hundred', () => {
    expect(paginationSchema.parse({ limit: 101 }).limit).toBe(MAX_LIMIT);
  });

  it('reduces a very large request to one hundred rather than refusing it', () => {
    expect(paginationSchema.parse({ limit: 100000 }).limit).toBe(MAX_LIMIT);
  });

  it('allows exactly one hundred records', () => {
    expect(paginationSchema.parse({ limit: 100 }).limit).toBe(MAX_LIMIT);
  });

  it('allows a single record', () => {
    expect(paginationSchema.parse({ limit: 1 }).limit).toBe(1);
  });

  it('accepts a page size that arrived as text from a web address', () => {
    expect(paginationSchema.parse({ limit: '30' }).limit).toBe(30);
  });

  it('refuses a request for no records at all', () => {
    expect(refused({ limit: 0 })).toBe(PAGINATION_MESSAGES.tooSmall);
  });

  it('refuses a request for a negative number of records', () => {
    expect(refused({ limit: -1 })).toBe(PAGINATION_MESSAGES.tooSmall);
  });

  it('refuses a page size that is not a number', () => {
    expect(refused({ limit: 'all of them' })).toBe(PAGINATION_MESSAGES.notANumber);
  });

  it('refuses a page size left blank', () => {
    expect(refused({ limit: '' })).toBe(PAGINATION_MESSAGES.notANumber);
  });

  it('refuses a page size with a decimal point', () => {
    expect(refused({ limit: 10.5 })).toBe(PAGINATION_MESSAGES.notWhole);
  });
});

describe('the marker that says where the next page starts', () => {
  it('is allowed to be absent', () => {
    expect(paginationSchema.parse({}).cursor).toBeUndefined();
  });

  it('is kept exactly as it was given', () => {
    expect(paginationSchema.parse({ cursor: 'abc123' }).cursor).toBe('abc123');
  });

  it('refuses anything sent alongside it that is not recognised', () => {
    const result = paginationSchema.safeParse({ cursor: 'abc123', offset: 20 });
    expect(result.success).toBe(false);
  });
});
