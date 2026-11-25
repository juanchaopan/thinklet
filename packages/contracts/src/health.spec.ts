import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a response with every check ok', () => {
    const body = { status: 'ok', checks: { database: 'ok', storage: 'ok', redis: 'ok' } };

    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts a response with a failed check', () => {
    const body = { status: 'error', checks: { database: 'ok', storage: 'ok', redis: 'error' } };

    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects an unknown status value', () => {
    const body = { status: 'degraded', checks: { database: 'ok', storage: 'ok', redis: 'ok' } };

    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });

  it.each(['database', 'storage', 'redis'])('rejects a response without the %s check', (name) => {
    const checks = Object.fromEntries(
      ['database', 'storage', 'redis']
        .filter((check) => check !== name)
        .map((check) => [check, 'ok']),
    );

    expect(healthResponseSchema.safeParse({ status: 'ok', checks }).success).toBe(false);
  });

  it('rejects extra keys such as error details', () => {
    const body = {
      status: 'error',
      checks: { database: 'error', storage: 'ok', redis: 'ok' },
      error: 'connection refused',
    };
    const nested = {
      status: 'error',
      checks: { database: 'error', storage: 'ok', redis: 'ok', reason: 'timeout' },
    };

    expect(healthResponseSchema.safeParse(body).success).toBe(false);
    expect(healthResponseSchema.safeParse(nested).success).toBe(false);
  });
});
