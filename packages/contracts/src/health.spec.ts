import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a response with every check ok', () => {
    const body = { status: 'ok', checks: { database: 'ok', storage: 'ok' } };

    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a response with a failed check', () => {
    const body = { status: 'error', checks: { database: 'ok', storage: 'error' } };

    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects an unknown status value', () => {
    const body = { status: 'degraded', checks: { database: 'ok', storage: 'ok' } };

    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a missing check', () => {
    const body = { status: 'ok', checks: { database: 'ok' } };

    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects extra keys such as error details', () => {
    const body = {
      status: 'error',
      checks: { database: 'error', storage: 'ok' },
      error: 'connection refused',
    };
    const nested = {
      status: 'error',
      checks: { database: 'error', storage: 'ok', reason: 'timeout' },
    };

    expect(healthResponseSchema.safeParse(body).success).toBe(false);
    expect(healthResponseSchema.safeParse(nested).success).toBe(false);
  });
});
