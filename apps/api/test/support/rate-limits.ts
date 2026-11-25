import { randomInt } from 'node:crypto';
import { errorResponseSchema, FAMILY_CODE_ALPHABET, FAMILY_CODE_LENGTH } from '@thinklet/contracts';
import type request from 'supertest';

// Helpers for tests of the limits on a source's failures: sources of their
// own, so tests that share an api and its Redis never share a count, codes
// no family has, and the answer of a refused attempt.

/** A client IP address of a private range, new to the test run. */
export function newClientIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** A family code of the right form that no family has, in all likelihood. */
export function unknownFamilyCode(): string {
  return Array.from(
    { length: FAMILY_CODE_LENGTH },
    () => FAMILY_CODE_ALPHABET[randomInt(FAMILY_CODE_ALPHABET.length)],
  ).join('');
}

/**
 * Asserts a 429 `rate_limited` that says the same seconds left in its body
 * and its Retry-After header, at most the window's, and returns them.
 */
export function expectRateLimited(response: request.Response, windowSeconds: number): number {
  expect(response.status).toBe(429);
  const { error } = errorResponseSchema.parse(response.body);
  expect(error.code).toBe('rate_limited');
  const seconds = error.retryAfterSeconds ?? 0;
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(windowSeconds);
  expect(response.headers['retry-after']).toBe(String(seconds));
  return seconds;
}
