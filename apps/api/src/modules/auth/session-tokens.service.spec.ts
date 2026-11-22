import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { base64url, decodeJwt, decodeProtectedHeader, SignJWT, UnsecuredJWT } from 'jose';
import type { Environment, SigningKey } from '../../infrastructure/config/environment.js';
import { SessionTokensService, type LoginTransaction } from './session-tokens.service.js';

function newKey(kid = `key-${randomUUID()}`): SigningKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...(privateKey.export({ format: 'jwk' }) as SigningKey), kid };
}

function serviceWith(key: SigningKey): SessionTokensService {
  return new SessionTokensService({ get: () => key } as unknown as ConfigService<
    Environment,
    true
  >);
}

const key = newKey();
const tokens = serviceWith(key);
const parentId = randomUUID();
const now = new Date('2026-11-21T09:00:00Z');
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

const transaction: LoginTransaction = {
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'verifier-1',
  returnTo: '/profile',
};

/** The token with its payload replaced, keeping the header and signature. */
function withPayload(token: string, payload: object): string {
  const [header, , signature] = token.split('.');
  return [header, base64url.encode(JSON.stringify(payload)), signature].join('.');
}

describe('SessionTokensService', () => {
  describe('session JWTs', () => {
    it('carry only the parent id, the issue time and a 7-day expiry, signed ES256 with the key id', async () => {
      const token = await tokens.issueSession(parentId, now);

      expect(decodeProtectedHeader(token)).toEqual({ alg: 'ES256', kid: key.kid, typ: 'JWT' });
      expect(decodeJwt(token)).toEqual({
        sub: parentId,
        iat: now.getTime() / 1000,
        exp: now.getTime() / 1000 + 604_800,
      });
    });

    it('verify to the parent and the expiry', async () => {
      const token = await tokens.issueSession(parentId, now);

      await expect(tokens.verifySession(token, later(60))).resolves.toEqual({
        parentId,
        expiresAt: later(604_800),
      });
    });

    it('are not valid once expired', async () => {
      const token = await tokens.issueSession(parentId, now);

      await expect(tokens.verifySession(token, later(604_800))).resolves.toBeUndefined();
    });

    it('are not valid when missing or malformed', async () => {
      await expect(tokens.verifySession(undefined, now)).resolves.toBeUndefined();
      await expect(tokens.verifySession('not-a-jwt', now)).resolves.toBeUndefined();
    });

    it('are not valid with a changed payload', async () => {
      const token = await tokens.issueSession(parentId, now);
      const tampered = withPayload(token, { ...decodeJwt(token), sub: randomUUID() });

      await expect(tokens.verifySession(tampered, now)).resolves.toBeUndefined();
    });

    it('are not valid when signed by another key, even under the same key id', async () => {
      const other = await serviceWith(newKey(key.kid)).issueSession(parentId, now);

      await expect(tokens.verifySession(other, now)).resolves.toBeUndefined();
    });

    it('are not valid when they name another key id', async () => {
      const renamed = await serviceWith({ ...key, kid: 'other-key' }).issueSession(parentId, now);

      await expect(tokens.verifySession(renamed, now)).resolves.toBeUndefined();
    });

    it('are not valid unsigned (alg none)', async () => {
      const unsigned = new UnsecuredJWT({ sub: parentId })
        .setIssuedAt(now)
        .setExpirationTime(later(600))
        .encode();

      await expect(tokens.verifySession(unsigned, now)).resolves.toBeUndefined();
    });

    it('are not valid signed with HS256 and the public key as the secret', async () => {
      const publicJwk = JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
      const forged = await new SignJWT({ sub: parentId })
        .setProtectedHeader({ alg: 'HS256', kid: key.kid, typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(later(600))
        .sign(new TextEncoder().encode(publicJwk));

      await expect(tokens.verifySession(forged, now)).resolves.toBeUndefined();
    });

    it('are not valid when the subject is not a parent id', async () => {
      const token = await tokens.issueSession('not-a-uuid', now);

      await expect(tokens.verifySession(token, now)).resolves.toBeUndefined();
    });
  });

  describe('login transaction tokens', () => {
    it('verify to the login under way within 10 minutes', async () => {
      const token = await tokens.issueLoginTransaction(transaction, now);

      expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'ES256', kid: key.kid });
      await expect(tokens.verifyLoginTransaction(token, later(599))).resolves.toEqual(transaction);
    });

    it('are not valid after 10 minutes', async () => {
      const token = await tokens.issueLoginTransaction(transaction, now);

      await expect(tokens.verifyLoginTransaction(token, later(600))).resolves.toBeUndefined();
    });

    it('are not valid with a changed state', async () => {
      const token = await tokens.issueLoginTransaction(transaction, now);
      const tampered = withPayload(token, { ...decodeJwt(token), state: 'state-2' });

      await expect(tokens.verifyLoginTransaction(tampered, now)).resolves.toBeUndefined();
    });

    it('are not accepted as a session, nor a session as one of them', async () => {
      const login = await tokens.issueLoginTransaction(transaction, now);
      const session = await tokens.issueSession(parentId, now);

      await expect(tokens.verifySession(login, now)).resolves.toBeUndefined();
      await expect(tokens.verifyLoginTransaction(session, now)).resolves.toBeUndefined();
    });
  });
});
