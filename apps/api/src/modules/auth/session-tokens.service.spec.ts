import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
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
const childId = randomUUID();
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

/** A session JWT with the given claims, signed with the service's own key. */
function signedWith(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', kid: key.kid, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(later(600))
    .sign(createPrivateKey({ key, format: 'jwk' }));
}

describe('SessionTokensService', () => {
  describe('session JWTs', () => {
    it.each([
      ['parent', parentId],
      ['child', childId],
    ] as const)(
      'of a %s carry only the id, the kind, the issue time and a 7-day expiry, signed ES256 with the key id',
      async (kind, id) => {
        const token = await tokens.issueSession(kind, id, now);

        expect(decodeProtectedHeader(token)).toEqual({ alg: 'ES256', kid: key.kid, typ: 'JWT' });
        expect(decodeJwt(token)).toEqual({
          sub: id,
          kind,
          iat: now.getTime() / 1000,
          exp: now.getTime() / 1000 + 604_800,
        });
      },
    );

    it('verify to the id, the issue time and the expiry for their own kind', async () => {
      const parent = await tokens.issueSession('parent', parentId, now);
      const child = await tokens.issueSession('child', childId, now);

      await expect(tokens.verifySession(parent, 'parent', later(60))).resolves.toEqual({
        id: parentId,
        issuedAt: now,
        expiresAt: later(604_800),
      });
      await expect(tokens.verifySession(child, 'child', later(60))).resolves.toEqual({
        id: childId,
        issuedAt: now,
        expiresAt: later(604_800),
      });
    });

    it('carry the issue time in whole seconds', async () => {
      const token = await tokens.issueSession('child', childId, new Date(now.getTime() + 999));

      await expect(tokens.verifySession(token, 'child', now)).resolves.toMatchObject({
        issuedAt: now,
      });
    });

    it('are not valid as another kind: a child is no parent, nor a parent a child', async () => {
      const parent = await tokens.issueSession('parent', parentId, now);
      const child = await tokens.issueSession('child', childId, now);

      await expect(tokens.verifySession(child, 'parent', now)).resolves.toBeUndefined();
      await expect(tokens.verifySession(parent, 'child', now)).resolves.toBeUndefined();
    });

    it.each<[string, Record<string, unknown>]>([
      ['without a kind', { sub: parentId }],
      ['with an unknown kind', { sub: parentId, kind: 'admin' }],
      ['with the kind in another case', { sub: parentId, kind: 'Parent' }],
      ['with several kinds', { sub: parentId, kind: ['parent', 'child'] }],
      ['with a claim more', { sub: parentId, kind: 'parent', familyId: randomUUID() }],
    ])('are not valid %s, even when signed with the key', async (_name, claims) => {
      const token = await signedWith(claims);

      await expect(tokens.verifySession(token, 'parent', now)).resolves.toBeUndefined();
      await expect(tokens.verifySession(token, 'child', now)).resolves.toBeUndefined();
    });

    it('are valid signed with the key when the claims are right, so the cases above fail on the claims', async () => {
      const token = await signedWith({ sub: parentId, kind: 'parent' });

      await expect(tokens.verifySession(token, 'parent', now)).resolves.toMatchObject({
        id: parentId,
      });
    });

    it('are not valid with the kind changed in the payload', async () => {
      const child = await tokens.issueSession('child', parentId, now);
      const tampered = withPayload(child, { ...decodeJwt(child), kind: 'parent' });

      await expect(tokens.verifySession(tampered, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid once expired', async () => {
      const token = await tokens.issueSession('parent', parentId, now);

      await expect(tokens.verifySession(token, 'parent', later(604_800))).resolves.toBeUndefined();
    });

    it('are not valid when missing or malformed', async () => {
      await expect(tokens.verifySession(undefined, 'parent', now)).resolves.toBeUndefined();
      await expect(tokens.verifySession('not-a-jwt', 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid with a changed payload', async () => {
      const token = await tokens.issueSession('parent', parentId, now);
      const tampered = withPayload(token, { ...decodeJwt(token), sub: randomUUID() });

      await expect(tokens.verifySession(tampered, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid when signed by another key, even under the same key id', async () => {
      const other = await serviceWith(newKey(key.kid)).issueSession('parent', parentId, now);

      await expect(tokens.verifySession(other, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid when they name another key id', async () => {
      const renamed = await serviceWith({ ...key, kid: 'other-key' }).issueSession(
        'parent',
        parentId,
        now,
      );

      await expect(tokens.verifySession(renamed, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid unsigned (alg none)', async () => {
      const unsigned = new UnsecuredJWT({ sub: parentId, kind: 'parent' })
        .setIssuedAt(now)
        .setExpirationTime(later(600))
        .encode();

      await expect(tokens.verifySession(unsigned, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid signed with HS256 and the public key as the secret', async () => {
      const publicJwk = JSON.stringify({ kty: key.kty, crv: key.crv, x: key.x, y: key.y });
      const forged = await new SignJWT({ sub: parentId, kind: 'parent' })
        .setProtectedHeader({ alg: 'HS256', kid: key.kid, typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(later(600))
        .sign(new TextEncoder().encode(publicJwk));

      await expect(tokens.verifySession(forged, 'parent', now)).resolves.toBeUndefined();
    });

    it('are not valid when the subject is not an id', async () => {
      const token = await tokens.issueSession('parent', 'not-a-uuid', now);

      await expect(tokens.verifySession(token, 'parent', now)).resolves.toBeUndefined();
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

    it('are not accepted as a session of either kind, nor a session as one of them', async () => {
      const login = await tokens.issueLoginTransaction(transaction, now);
      const session = await tokens.issueSession('parent', parentId, now);

      await expect(tokens.verifySession(login, 'parent', now)).resolves.toBeUndefined();
      await expect(tokens.verifySession(login, 'child', now)).resolves.toBeUndefined();
      await expect(tokens.verifyLoginTransaction(session, now)).resolves.toBeUndefined();
    });
  });
});
