import { createHash } from 'node:crypto';
import { hashToken, newToken, TOKEN_BYTES } from './tokens.js';

describe('newToken', () => {
  it('is 32 random bytes written in base64url', () => {
    const { token } = newToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(TOKEN_BYTES);
    expect(Buffer.from(token, 'base64url').toString('base64url')).toBe(token);
  });

  it('comes with the SHA-256 of the token in hex', () => {
    const { token, hash } = newToken();

    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => newToken().token));

    expect(tokens.size).toBe(20);
  });
});

describe('hashToken', () => {
  it('gives the same hash for the same token and another for another token', () => {
    expect(hashToken('token-a')).toBe(hashToken('token-a'));
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});
