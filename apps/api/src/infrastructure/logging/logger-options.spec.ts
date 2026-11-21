import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import {
  httpLoggerOptions,
  loggerOptions,
  secretValues,
  withoutQuery,
  type SecretSettings,
} from './logger-options.js';

const settings: SecretSettings = {
  DATABASE_URL: 'postgresql://app:p%40ss-word@db.internal:5432/app',
  S3_ACCESS_KEY_ID: 'access-key-id',
  S3_SECRET_ACCESS_KEY: 'secret-access-key',
  OIDC_CLIENT_SECRET: 'oidc-client-secret',
  JWT_SIGNING_KEY: { d: 'signing-key-d' },
};

function captureLogs(secrets: readonly string[]) {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: pino(loggerOptions(secrets), destination), output: () => lines.join('') };
}

/** A logged request as pino's standard serializer writes it. */
interface LoggedRequest {
  url?: string;
  query?: unknown;
  method?: string;
}

describe('secretValues', () => {
  it('lists the database URL, its password in both forms, the storage credentials, the client secret and the signing key', () => {
    expect(secretValues(settings)).toEqual([
      settings.DATABASE_URL,
      'p%40ss-word',
      'p@ss-word',
      'access-key-id',
      'secret-access-key',
      'oidc-client-secret',
      'signing-key-d',
    ]);
  });

  it('keeps a password whose percent escape cannot be decoded as written', () => {
    const malformed = { ...settings, DATABASE_URL: 'postgresql://app:p%zz@db.internal:5432/app' };

    expect(secretValues(malformed).slice(0, 3)).toEqual([malformed.DATABASE_URL, 'p%zz', 'p%zz']);
  });
});

describe('loggerOptions', () => {
  it('redacts authorization headers, cookies, the login redirect and passwords', () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      req: { headers: { authorization: 'Bearer token-1', cookie: 'session=cookie-1' } },
      res: {
        headers: { 'set-cookie': 'session=cookie-2', location: 'https://idp/?state=state-1' },
      },
      user: { password: 'password-1' },
    });

    expect(output()).toContain('[redacted]');
    for (const value of ['token-1', 'cookie-1', 'cookie-2', 'state-1', 'password-1']) {
      expect(output()).not.toContain(value);
    }
  });

  it("redacts a parent's name and email and the claims of an ID token", () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      parent: { name: 'name-1', email: 'email-1' },
      me: { name: 'name-2' },
      login: { claims: { name: 'name-3' }, parentName: 'name-4' },
      email: 'email-2',
    });

    for (const value of ['name-1', 'name-2', 'name-3', 'name-4', 'email-1', 'email-2']) {
      expect(output()).not.toContain(value);
    }
  });

  it('keeps the name of an error, which is its type', () => {
    const { logger, output } = captureLogs([]);

    logger.warn({ error: { name: 'TypeError', message: 'bad input' } });

    expect(output()).toContain('TypeError');
  });

  it('redacts tokens of the login wherever they are nested', () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      idToken: 'token-1',
      tokens: { id_token: 'token-2', access_token: 'token-3', refresh_token: 'token-4' },
      login: { sessionToken: 'token-5', loginToken: 'token-6', codeVerifier: 'token-7' },
      request: { cookies: { thinklet_session: 'token-8' } },
    });

    for (const value of [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `token-${n}`)) {
      expect(output()).not.toContain(value);
    }
  });

  it('redacts fields named after secret variables', () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      config: {
        DATABASE_URL: 'url-1',
        S3_SECRET_ACCESS_KEY: 'key-1',
        OIDC_CLIENT_SECRET: 'secret-1',
        JWT_SIGNING_KEY: 'key-2',
      },
    });

    for (const value of ['url-1', 'key-1', 'secret-1', 'key-2']) {
      expect(output()).not.toContain(value);
    }
  });

  it('replaces secret values wherever they appear in a line', () => {
    const { logger, output } = captureLogs(secretValues(settings));

    logger.warn(
      { detail: `password p@ss-word for ${settings.DATABASE_URL} and signing-key-d` },
      'using secret-access-key with access-key-id and oidc-client-secret',
    );

    for (const secret of secretValues(settings)) {
      expect(output()).not.toContain(secret);
    }
    expect(output()).toContain('[redacted]');
  });

  it('replaces secrets that contain characters JSON escapes', () => {
    const { logger, output } = captureLogs(['quote"hidden']);

    logger.info('value quote"hidden');

    expect(output()).not.toContain('hidden');
  });

  it('ignores empty secrets', () => {
    const { logger, output } = captureLogs(['']);

    logger.info('plain message');

    expect((JSON.parse(output()) as { msg: unknown }).msg).toBe('plain message');
  });
});

describe('withoutQuery', () => {
  it('removes the query string and the parsed query of a logged request', () => {
    const logged = withoutQuery<LoggedRequest>({
      url: '/api/auth/callback?code=code-1&state=state-1',
      query: { code: 'code-1' },
      method: 'GET',
    });

    expect(logged).toEqual({ url: '/api/auth/callback', method: 'GET' });
  });

  it('keeps a URL without a query as it is', () => {
    expect(withoutQuery<LoggedRequest>({ url: '/api/me' })).toEqual({ url: '/api/me' });
  });

  it('leaves a request without a URL alone', () => {
    expect(withoutQuery<LoggedRequest>({ method: 'GET' })).toEqual({ method: 'GET' });
  });
});

describe('httpLoggerOptions', () => {
  it('gives each request a fresh id and returns it in the X-Request-Id header', () => {
    const { genReqId } = httpLoggerOptions([]);
    const headers = new Map<string, unknown>();
    const response = {
      headersSent: false,
      setHeader: (name: string, value: unknown) => headers.set(name, value),
    } as unknown as ServerResponse;

    const first = genReqId?.({} as IncomingMessage, response);
    const second = genReqId?.({} as IncomingMessage, response);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(headers.get('X-Request-Id')).toBe(second);
  });

  it('logs requests without their query string', () => {
    const { serializers } = httpLoggerOptions([]);

    expect(serializers?.['req']?.({ url: '/api/auth/login?returnTo=/x' })).toEqual({
      url: '/api/auth/login',
    });
  });
});
