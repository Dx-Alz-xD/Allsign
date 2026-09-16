import { describe, expect, it } from 'vitest';
import { parseRecord } from '../storage';

describe('parseRecord', () => {
  it('reads a saved account and drops malformed parts', () => {
    const raw = JSON.stringify({
      version: 1,
      email: 'ada@example.com',
      deviceToken: 'device-token',
      account: 'not an object',
      licence: null,
      refreshedAt: 42,
    });
    expect(parseRecord(raw)).toEqual({
      version: 1,
      email: 'ada@example.com',
      deviceToken: 'device-token',
      account: null,
      licence: null,
      refreshedAt: null,
    });
  });

  it('rejects anything that is not a version 1 record', () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord('{not json')).toBeNull();
    expect(parseRecord(JSON.stringify({ version: 2, email: 'a', deviceToken: 'b' }))).toBeNull();
    expect(parseRecord(JSON.stringify({ version: 1, email: 'a' }))).toBeNull();
  });
});
