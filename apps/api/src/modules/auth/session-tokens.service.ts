// The contracts package sets Zod to run without generated code before any
// schema exists (decision 0028); importing it first puts the schemas below
// under the same setting as every request schema.
import '@thinklet/contracts';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT, type JWTHeaderParameters, type JWTPayload } from 'jose';
import { z } from 'zod';
import type { Environment } from '../../infrastructure/config/environment.js';
import {
  LOGIN_TRANSACTION_LIFETIME_SECONDS,
  SESSION_LIFETIME_SECONDS,
} from './session-lifetime.js';

const ALGORITHM = 'ES256';

/**
 * The `typ` header of each kind of token. Both are signed with the same key,
 * so the type keeps one from being accepted as the other.
 */
const SESSION_TYPE = 'JWT';
const LOGIN_TRANSACTION_TYPE = 'thinklet-login+jwt';

/** A session JWT carries the parent's id and its issue and expiry times, nothing else. */
const sessionClaimsSchema = z.strictObject({
  sub: z.uuid(),
  iat: z.int(),
  exp: z.int(),
});

const loginTransactionSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(1),
  returnTo: z.string().min(1),
});

/** What a login under way keeps until the identity provider sends the parent back. */
export type LoginTransaction = z.infer<typeof loginTransactionSchema>;

/** A verified login: the signed-in parent and when the login expires. */
export interface Session {
  parentId: string;
  expiresAt: Date;
}

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

/**
 * Signs and verifies the api's own tokens with the ES256 key in
 * JWT_SIGNING_KEY: the session JWT of a signed-in parent and the token of a
 * login under way. Both carry the key's `kid`, so the key can be rotated; a
 * token signed by any other key, with another algorithm (including `none`),
 * of the other kind, or past its expiry is not valid.
 */
@Injectable()
export class SessionTokensService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly keyId: string;

  constructor(config: ConfigService<Environment, true>) {
    const jwk = config.get('JWT_SIGNING_KEY', { infer: true });
    this.privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    this.publicKey = createPublicKey(this.privateKey);
    this.keyId = jwk.kid;
  }

  /** A new session JWT for the parent, valid for 7 days from `now`. */
  issueSession(parentId: string, now = new Date()): Promise<string> {
    return this.sign({ sub: parentId }, SESSION_TYPE, SESSION_LIFETIME_SECONDS, now);
  }

  /** The login of a session JWT, or undefined when it is missing or not valid at `now`. */
  async verifySession(token: string | undefined, now = new Date()): Promise<Session | undefined> {
    const claims = sessionClaimsSchema.safeParse(await this.verify(token, SESSION_TYPE, now));
    if (!claims.success) {
      return undefined;
    }
    return { parentId: claims.data.sub, expiresAt: new Date(claims.data.exp * 1000) };
  }

  /** A token holding a login under way, valid for 10 minutes from `now`. */
  issueLoginTransaction(transaction: LoginTransaction, now = new Date()): Promise<string> {
    return this.sign(
      { ...transaction },
      LOGIN_TRANSACTION_TYPE,
      LOGIN_TRANSACTION_LIFETIME_SECONDS,
      now,
    );
  }

  /** The login under way in a token, or undefined when it is missing or not valid at `now`. */
  async verifyLoginTransaction(
    token: string | undefined,
    now = new Date(),
  ): Promise<LoginTransaction | undefined> {
    const transaction = loginTransactionSchema.safeParse(
      await this.verify(token, LOGIN_TRANSACTION_TYPE, now),
    );
    return transaction.success ? transaction.data : undefined;
  }

  private sign(claims: JWTPayload, type: string, lifetime: number, now: Date): Promise<string> {
    const issuedAt = toSeconds(now);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: ALGORITHM, kid: this.keyId, typ: type })
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetime)
      .sign(this.privateKey);
  }

  private async verify(
    token: string | undefined,
    type: string,
    now: Date,
  ): Promise<JWTPayload | undefined> {
    if (token === undefined) {
      return undefined;
    }
    try {
      const { payload } = await jwtVerify(token, (header) => this.keyFor(header), {
        algorithms: [ALGORITHM],
        typ: type,
        currentDate: now,
        requiredClaims: ['iat', 'exp'],
      });
      return payload;
    } catch {
      return undefined;
    }
  }

  /** The public key for a token's header; only tokens naming this key's id are verified. */
  private keyFor(header: JWTHeaderParameters): KeyObject {
    if (header.kid !== this.keyId) {
      throw new Error('The token names another signing key');
    }
    return this.publicKey;
  }
}
