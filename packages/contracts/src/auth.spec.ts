import { describe, expect, it } from 'vitest';
import { logoutResponseSchema } from './auth.js';

describe('logoutResponseSchema', () => {
  it('carries the address to sign out of Authing at', () => {
    const body = { endSessionUrl: 'https://example.authing.cn/oidc/session/end?client_id=abc' };

    expect(logoutResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a value that is not an address', () => {
    expect(logoutResponseSchema.safeParse({ endSessionUrl: 'not a url' }).success).toBe(false);
  });
});
