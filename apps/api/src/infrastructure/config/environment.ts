// The contracts package sets Zod to run without generated code before any
// schema exists (decision 0028); importing it first puts the schemas below
// under the same setting as every request schema.
import '@thinklet/contracts';
import { createPrivateKey, createPublicKey, type webcrypto } from 'node:crypto';
import { z } from 'zod';
import { decodeCanonicalBase64 } from '../encoding/canonical-base64.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const httpUrl = z.url({ protocol: /^https?$/ });

/**
 * An origin exactly as a browser sends it in the Origin header: scheme, host
 * and an optional port, with no path, query, fragment or trailing slash, so
 * it can be compared with that header as it is. The comparison runs only on
 * a valid URL.
 */
const origin = httpUrl.pipe(
  z.string().refine((value) => new URL(value).origin === value, {
    message:
      'Must be an origin such as https://example.com or http://localhost:4200, with no path, query, fragment or trailing slash',
  }),
);

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, 'Must be base64url');

/** The fewest characters a shared secret the api checks requests with may have. */
export const SHARED_SECRET_MIN_LENGTH = 16;

/** Whether the JWK is a private key whose public coordinates belong to it. */
function isConsistentPrivateKey(jwk: webcrypto.JsonWebKey): boolean {
  try {
    const derived = createPublicKey(createPrivateKey({ key: jwk, format: 'jwk' })).export({
      format: 'jwk',
    });
    return derived.x === jwk.x && derived.y === jwk.y;
  } catch {
    return false;
  }
}

/**
 * The ES256 private key that signs the login JWTs and the short-lived login
 * cookie, as a JWK. The public key is derived from it; `kid` goes into every
 * JWT header so the key can be rotated. The key itself is checked only once
 * every member has the right form, so a malformed member is reported alone.
 */
const signingKeySchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: base64url,
    y: base64url,
    d: base64url,
    kid: z.string().min(1),
    alg: z.literal('ES256').optional(),
  })
  .refine(isConsistentPrivateKey, {
    message: 'Must be a valid P-256 private key',
    when: (payload) => payload.issues.length === 0,
  });

export type SigningKey = z.infer<typeof signingKeySchema>;

/**
 * JSON text parsed into a value. A parse failure gets its own message rather
 * than JSON.parse's, which quotes part of the text and so part of a secret.
 */
const json = z.string().transform((value, context): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Must be JSON' });
    return z.NEVER;
  }
});

/**
 * Standard base64 text decoded into exactly `length` bytes. The text must be
 * the canonical encoding of those bytes, padding included, so a key cut off,
 * written in base64url or with stray characters is refused rather than read
 * as other bytes. The message never repeats the text.
 */
function base64Bytes(length: number) {
  return z.string().transform((value, context) => {
    const bytes = decodeCanonicalBase64(value, 'base64');
    if (bytes?.length !== length) {
      context.addIssue({
        code: 'custom',
        message: `Must be ${length} bytes written in standard base64`,
      });
      return z.NEVER;
    }
    return bytes;
  });
}

/**
 * Every environment variable the api reads. ConfigModule validates
 * `process.env` against it at startup and refuses to start, naming each bad
 * variable, when one is missing or malformed.
 */
export const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  S3_ENDPOINT: httpUrl,
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  /**
   * The Redis the api keeps short-lived data in, such as the rate limits'
   * counters: `redis://` on a development machine and in tests, `rediss://`
   * (TLS) with a password in staging.
   */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /**
   * The request header, in lower case, that the proxy in front of the api
   * writes the client's IP address into. The api takes the source of a
   * request from this header alone, never from the connection, which comes
   * from the proxy.
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Must be a header name in lower case, such as x-real-ip'),
  /** The identity provider's issuer; every other endpoint comes from its discovery document. */
  OIDC_ISSUER: httpUrl,
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  /** The site's own origin: the base of the login callback and the only Origin accepted on writes. */
  APP_ORIGIN: origin,
  /** A JSON string in the environment, parsed into the JWK for the rest of the api. */
  JWT_SIGNING_KEY: json.pipe(signingKeySchema),
  /**
   * The master key of children's personal data: 32 random bytes, base64 in
   * the environment and the bytes themselves for the rest of the api, which
   * derives the encryption and lookup keys from it (decision 0034). 32 bytes
   * is the key length of both AES-256 and HMAC-SHA256.
   */
  CHILD_DATA_KEY: base64Bytes(32),
  /**
   * The origin of Authing's management API, which deletes a parent's
   * account (decision 0038): Authing's own in staging, the stand-in service
   * of the tests on a development machine and in tests.
   */
  AUTHING_MANAGEMENT_ORIGIN: origin,
  /** The id of the Authing user pool, with which the api asks for a management token. */
  AUTHING_USER_POOL_ID: z.string().min(1),
  /** The user pool's secret: it manages the whole pool, so it is never logged. */
  AUTHING_USER_POOL_SECRET: z.string().min(1),
  /**
   * The secret Authing sends in a header of its webhook, which proves the
   * notification comes from it. Long enough that it cannot be guessed.
   */
  AUTHING_WEBHOOK_SECRET: z
    .string()
    .min(SHARED_SECRET_MIN_LENGTH, `Must have at least ${SHARED_SECRET_MIN_LENGTH} characters`),
});

export type Environment = z.infer<typeof environmentSchema>;
