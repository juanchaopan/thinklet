import { createHash, randomBytes } from 'node:crypto';

/**
 * The random bytes in a login link's token and in a device token
 * (`.docs/design/rules.md`, "登录二维码"; `.docs/design/data.md`, "浏览器里存的").
 */
export const TOKEN_BYTES = 32;

/** A token and the only form of it the database keeps. */
export interface NewToken {
  /** The token in base64url, for the link or the cookie; never stored or logged. */
  token: string;
  /** The SHA-256 of the token in hex, as the database stores and looks it up. */
  hash: string;
}

/** The SHA-256 of a token in hex. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A new token of 32 random bytes in base64url, with its hash. */
export function newToken(): NewToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}
