import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { environmentSchema } from './environment.js';

/** A fresh ES256 private key as a JWK with a key id, as JWT_SIGNING_KEY holds it. */
function newSigningKey(): Record<string, string> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...(privateKey.export({ format: 'jwk' }) as Record<string, string>), kid: 'test-key' };
}

const signingKey = newSigningKey();
const otherKey = newSigningKey();
const childDataKey = randomBytes(32);
/** childDataKey in the standard base64 that CHILD_DATA_KEY holds. */
const childDataKeyText = childDataKey.toString('base64');

const valid = {
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/app',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
  REDIS_URL: 'redis://127.0.0.1:6379',
  CLIENT_IP_HEADER: 'x-forwarded-for',
  OIDC_ISSUER: 'http://localhost:8080/default',
  OIDC_CLIENT_ID: 'client-id',
  OIDC_CLIENT_SECRET: 'client-secret',
  APP_ORIGIN: 'http://localhost:4200',
  JWT_SIGNING_KEY: JSON.stringify(signingKey),
  CHILD_DATA_KEY: childDataKeyText,
  AUTHING_MANAGEMENT_ORIGIN: 'http://127.0.0.1:8090',
  AUTHING_USER_POOL_ID: 'user-pool-id',
  AUTHING_USER_POOL_SECRET: 'user-pool-secret',
  AUTHING_WEBHOOK_SECRET: 'webhook-secret-of-the-tests',
};

function failingVariables(input: Record<string, unknown>): string[] {
  const result = environmentSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
}

/** JWT_SIGNING_KEY holding the signing key with the given members replaced, or removed when undefined. */
function signingKeyWith(changes: Record<string, string | undefined>): string {
  return JSON.stringify({ ...signingKey, ...changes });
}

/** 32 bytes whose base64 has both `+` and `/`, the characters base64url writes differently. */
const keyWithBase64OnlyCharacters = Buffer.alloc(32, 0xfb);

describe('environmentSchema', () => {
  it('accepts a complete environment, applies defaults and parses the keys', () => {
    expect(environmentSchema.parse(valid)).toEqual({
      ...valid,
      PORT: 3000,
      S3_FORCE_PATH_STYLE: false,
      JWT_SIGNING_KEY: signingKey,
      CHILD_DATA_KEY: childDataKey,
    });
  });

  it('converts PORT and S3_FORCE_PATH_STYLE from strings', () => {
    const environment = environmentSchema.parse({
      ...valid,
      PORT: '8080',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(environment.PORT).toBe(8080);
    expect(environment.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('ignores variables it does not declare', () => {
    expect(environmentSchema.parse({ ...valid, HOME: '/home/user' })).not.toHaveProperty('HOME');
  });

  it.each(Object.keys(valid))('names %s when it is missing', (name) => {
    const input = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== name));

    expect(failingVariables(input)).toEqual([name]);
  });

  it.each([
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'REDIS_URL',
    'CLIENT_IP_HEADER',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'APP_ORIGIN',
    'JWT_SIGNING_KEY',
    'CHILD_DATA_KEY',
    'AUTHING_MANAGEMENT_ORIGIN',
    'AUTHING_USER_POOL_ID',
    'AUTHING_USER_POOL_SECRET',
    'AUTHING_WEBHOOK_SECRET',
  ])('names %s when it is empty', (name) => {
    expect(failingVariables({ ...valid, [name]: '' })).toEqual([name]);
  });

  it('names DATABASE_URL when it is not a PostgreSQL URL', () => {
    expect(failingVariables({ ...valid, DATABASE_URL: 'mysql://localhost/app' })).toEqual([
      'DATABASE_URL',
    ]);
    expect(failingVariables({ ...valid, DATABASE_URL: 'not a url' })).toEqual(['DATABASE_URL']);
  });

  it('names S3_ENDPOINT when it is not an HTTP URL', () => {
    expect(failingVariables({ ...valid, S3_ENDPOINT: 'ftp://localhost' })).toEqual(['S3_ENDPOINT']);
  });

  it('accepts a TLS Redis address with a password as REDIS_URL', () => {
    const url = 'rediss://default:secret@example.upstash.io:6379';

    expect(environmentSchema.parse({ ...valid, REDIS_URL: url }).REDIS_URL).toBe(url);
  });

  it.each(['http://127.0.0.1:6379', 'not a url'])('names REDIS_URL when it is %s', (url) => {
    expect(failingVariables({ ...valid, REDIS_URL: url })).toEqual(['REDIS_URL']);
  });

  it.each(['x-real-ip', 'x-vercel-forwarded-for', 'cf-connecting-ip'])(
    'accepts %s as CLIENT_IP_HEADER',
    (header) => {
      expect(environmentSchema.parse({ ...valid, CLIENT_IP_HEADER: header }).CLIENT_IP_HEADER).toBe(
        header,
      );
    },
  );

  it.each([
    ['upper case', 'X-Real-IP'],
    ['a colon', 'x-real-ip:'],
    ['a space', 'x real ip'],
    ['a leading dash', '-x-real-ip'],
  ])('names CLIENT_IP_HEADER when it has %s', (_case, header) => {
    expect(failingVariables({ ...valid, CLIENT_IP_HEADER: header })).toEqual(['CLIENT_IP_HEADER']);
  });

  it.each(['0', '65536', 'abc', '80.5'])('names PORT when it is %s', (port) => {
    expect(failingVariables({ ...valid, PORT: port })).toEqual(['PORT']);
  });

  it('names S3_FORCE_PATH_STYLE when it is not true or false', () => {
    expect(failingVariables({ ...valid, S3_FORCE_PATH_STYLE: 'yes' })).toEqual([
      'S3_FORCE_PATH_STYLE',
    ]);
  });

  it.each(['ftp://idp.example.com/issuer', 'not a url'])(
    'names OIDC_ISSUER when it is %s',
    (issuer) => {
      expect(failingVariables({ ...valid, OIDC_ISSUER: issuer })).toEqual(['OIDC_ISSUER']);
    },
  );

  it.each(['https://example.com', 'http://127.0.0.1:43123', 'https://app.example.com:8443'])(
    'accepts the origin %s as APP_ORIGIN',
    (appOrigin) => {
      expect(environmentSchema.parse({ ...valid, APP_ORIGIN: appOrigin }).APP_ORIGIN).toBe(
        appOrigin,
      );
    },
  );

  it.each([
    ['a trailing slash', 'http://localhost:4200/'],
    ['a path', 'https://example.com/app'],
    ['a query', 'https://example.com?page=1'],
    ['a fragment', 'https://example.com#top'],
    ['credentials', 'https://user:password@example.com'],
    ['the default port', 'https://example.com:443'],
    ['upper case', 'HTTPS://EXAMPLE.COM'],
    ['a scheme other than HTTP', 'ftp://example.com'],
    ['no URL', 'example.com'],
  ])('names APP_ORIGIN when it has %s', (_case, appOrigin) => {
    expect(failingVariables({ ...valid, APP_ORIGIN: appOrigin })).toEqual(['APP_ORIGIN']);
  });

  it("accepts Authing's own origin as AUTHING_MANAGEMENT_ORIGIN", () => {
    expect(
      environmentSchema.parse({ ...valid, AUTHING_MANAGEMENT_ORIGIN: 'https://api.authing.cn' })
        .AUTHING_MANAGEMENT_ORIGIN,
    ).toBe('https://api.authing.cn');
  });

  it.each([
    ['a path', 'https://api.authing.cn/api/v3'],
    ['a trailing slash', 'https://api.authing.cn/'],
    ['no URL', 'api.authing.cn'],
  ])('names AUTHING_MANAGEMENT_ORIGIN when it has %s', (_case, value) => {
    expect(failingVariables({ ...valid, AUTHING_MANAGEMENT_ORIGIN: value })).toEqual([
      'AUTHING_MANAGEMENT_ORIGIN',
    ]);
  });

  it('names AUTHING_WEBHOOK_SECRET when it is shorter than 16 characters', () => {
    expect(failingVariables({ ...valid, AUTHING_WEBHOOK_SECRET: 'a'.repeat(15) })).toEqual([
      'AUTHING_WEBHOOK_SECRET',
    ]);
    expect(
      environmentSchema.parse({ ...valid, AUTHING_WEBHOOK_SECRET: 'a'.repeat(16) })
        .AUTHING_WEBHOOK_SECRET,
    ).toBe('a'.repeat(16));
  });

  it('accepts a signing key that names its algorithm ES256', () => {
    const environment = environmentSchema.parse({
      ...valid,
      JWT_SIGNING_KEY: signingKeyWith({ alg: 'ES256' }),
    });

    expect(environment.JWT_SIGNING_KEY).toEqual({ ...signingKey, alg: 'ES256' });
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a JSON string', '"key"'],
    ['a JSON array', '[]'],
    ['a key of another type', signingKeyWith({ kty: 'RSA' })],
    ['a key on another curve', signingKeyWith({ crv: 'P-384' })],
    ['another algorithm', signingKeyWith({ alg: 'RS256' })],
    ['only a public key', signingKeyWith({ d: undefined })],
    ['no key id', signingKeyWith({ kid: undefined })],
    ['an empty key id', signingKeyWith({ kid: '' })],
    ['a private part that is not base64url', signingKeyWith({ d: 'a+b/c=' })],
    ['a private part of another key', signingKeyWith({ d: otherKey['d'] })],
    ['coordinates that are not on the curve', signingKeyWith({ x: otherKey['y'] })],
  ])('names JWT_SIGNING_KEY when it holds %s', (_case, value) => {
    expect(failingVariables({ ...valid, JWT_SIGNING_KEY: value })).toEqual(['JWT_SIGNING_KEY']);
  });

  it('decodes a child data key with every base64 character', () => {
    const environment = environmentSchema.parse({
      ...valid,
      CHILD_DATA_KEY: keyWithBase64OnlyCharacters.toString('base64'),
    });

    expect(environment.CHILD_DATA_KEY).toEqual(keyWithBase64OnlyCharacters);
  });

  it.each([
    ['text that is not base64', 'not base64 at all, not even close!!!!!!!!!!!'],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['31 bytes', randomBytes(31).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['64 bytes', randomBytes(64).toString('base64')],
    ['32 bytes in hex', childDataKey.toString('hex')],
    ['32 bytes in base64url', keyWithBase64OnlyCharacters.toString('base64url')],
    ['32 bytes in base64 without padding', childDataKeyText.replace(/=+$/, '')],
    ['32 bytes in base64 with a line break', childDataKeyText.replace(/^.{20}/, '$&\n')],
    ['32 bytes in base64 with spaces around', ` ${childDataKeyText} `],
    ['32 bytes in base64 followed by more text', `${childDataKeyText}AAAA`],
  ])('names CHILD_DATA_KEY when it holds %s', (_case, value) => {
    expect(failingVariables({ ...valid, CHILD_DATA_KEY: value })).toEqual(['CHILD_DATA_KEY']);
  });

  it('names every bad variable at once', () => {
    expect(failingVariables({ ...valid, DATABASE_URL: undefined, S3_BUCKET: '' })).toEqual([
      'DATABASE_URL',
      'S3_BUCKET',
    ]);
  });

  it('does not repeat the rejected value in its messages', () => {
    const result = environmentSchema.safeParse({ ...valid, DATABASE_URL: 'secret-value' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('secret-value');
  });

  it('does not repeat a rejected Redis address in its messages', () => {
    const url = 'https://default:redis-secret@example.upstash.io:6379';
    const result = environmentSchema.safeParse({ ...valid, REDIS_URL: url });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('redis-secret');
  });

  it('does not repeat a webhook secret that is too short in its messages', () => {
    const result = environmentSchema.safeParse({ ...valid, AUTHING_WEBHOOK_SECRET: 'short-hook' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('short-hook');
  });

  it.each([
    ['a key that does not match', signingKeyWith({ d: otherKey['d'] })],
    ['JSON cut off', JSON.stringify(signingKey).slice(0, -10)],
  ])('does not repeat the signing key in its messages for %s', (_case, value) => {
    const result = environmentSchema.safeParse({ ...valid, JWT_SIGNING_KEY: value });
    const messages = JSON.stringify(result.error?.issues);

    expect(result.success).toBe(false);
    expect(messages).not.toContain(signingKey['d']);
    expect(messages).not.toContain(otherKey['d']);
  });

  it('does not repeat the child data key in its messages', () => {
    const cutOff = childDataKeyText.slice(0, -8);
    const result = environmentSchema.safeParse({ ...valid, CHILD_DATA_KEY: cutOff });
    const messages = JSON.stringify(result.error?.issues);

    expect(result.success).toBe(false);
    expect(messages).not.toContain(cutOff);
  });
});
