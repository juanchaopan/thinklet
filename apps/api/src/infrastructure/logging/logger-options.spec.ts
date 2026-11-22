import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import {
  httpLoggerOptions,
  LOGGED_REQUEST_HEADERS,
  loggableHeaders,
  loggableRequest,
  loggableUrl,
  loggerOptions,
  secretValues,
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
  headers?: Record<string, unknown>;
  query?: unknown;
  params?: unknown;
  method?: string;
}

/** The headers a browser sends with a request made from a join page. */
const joinPageHeaders = {
  host: 'site.example',
  origin: 'https://site.example',
  'user-agent': 'Mozilla/5.0',
  'content-type': 'application/json',
  'content-length': '17',
  accept: 'application/json',
  cookie: 'thinklet_session=cookie-1',
  authorization: 'Bearer token-1',
  referer: 'https://site.example/join/ABC234',
  'x-unknown': 'unknown-1',
};

/** The headers of joinPageHeaders that are logged. */
const loggedJoinPageHeaders = {
  host: 'site.example',
  origin: 'https://site.example',
  'user-agent': 'Mozilla/5.0',
  'content-type': 'application/json',
  'content-length': '17',
};

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

describe('loggableUrl', () => {
  it('removes the query string', () => {
    expect(loggableUrl('/api/auth/callback?code=code-1&state=state-1')).toBe('/api/auth/callback');
  });

  it('keeps a path without a query or a sensitive segment as it is', () => {
    expect(loggableUrl('/api/families/family-1/join-requests')).toBe(
      '/api/families/family-1/join-requests',
    );
  });

  it('replaces the family code of a lookup', () => {
    expect(loggableUrl('/api/family-codes/ABC234')).toBe('/api/family-codes/[redacted]');
  });

  // The router matches without regard to case and with a trailing slash;
  // a longer path or a query does not bring the code back either.
  it.each([
    ['/API/Family-Codes/ABC234', '/API/Family-Codes/[redacted]'],
    ['/api/family-codes/ABC234/', '/api/family-codes/[redacted]/'],
    ['/api/family-codes/ABC234/more', '/api/family-codes/[redacted]/more'],
    ['/api/family-codes/ABC234?x=ABC234', '/api/family-codes/[redacted]'],
    ['/api/family-codes/AB%2FC234', '/api/family-codes/[redacted]'],
  ])('replaces the family code in %s', (url, logged) => {
    expect(loggableUrl(url)).toBe(logged);
  });

  it('keeps a path that only contains the sensitive prefix further on', () => {
    expect(loggableUrl('/api/me/family-codes/x')).toBe('/api/me/family-codes/x');
  });
});

describe('loggableHeaders', () => {
  it('keeps only the allowed headers', () => {
    expect(loggableHeaders(joinPageHeaders)).toEqual(loggedJoinPageHeaders);
  });

  it('leaves out the page address in any form and headers it does not know', () => {
    const logged = loggableHeaders({
      host: 'site.example',
      referer: 'https://site.example/?returnTo=%2Fjoin%2FABC234',
      'x-unknown': 'unknown-1',
    });

    expect(logged).toEqual({ host: 'site.example' });
    expect(JSON.stringify(logged)).not.toContain('ABC234');
  });

  it('leaves the allowed headers a request does not have out', () => {
    expect(loggableHeaders({})).toEqual({});
  });

  it('allows no header that carries a page address, a login or a forwarded client', () => {
    for (const name of ['referer', 'cookie', 'authorization', 'x-forwarded-for', 'forwarded']) {
      expect(LOGGED_REQUEST_HEADERS).not.toContain(name);
    }
  });

  it("does not change the request's own headers", () => {
    const headers = { ...joinPageHeaders };

    loggableHeaders(headers);

    expect(headers).toEqual(joinPageHeaders);
  });
});

describe('loggableRequest', () => {
  it('logs the loggable URL without the parsed query and route parameters', () => {
    const logged = loggableRequest<LoggedRequest>({
      url: '/api/family-codes/ABC234?code=code-1',
      query: { code: 'code-1' },
      params: { splat: ['family-codes', 'ABC234'] },
      method: 'GET',
    });

    expect(logged).toEqual({ url: '/api/family-codes/[redacted]', method: 'GET' });
  });

  it('logs only the allowed headers, without the referer and unknown headers', () => {
    const logged = loggableRequest<LoggedRequest>({
      url: '/api/me',
      headers: { ...joinPageHeaders },
      method: 'GET',
    });

    expect(logged).toEqual({ url: '/api/me', headers: loggedJoinPageHeaders, method: 'GET' });
  });

  it('leaves a request without a URL or headers alone', () => {
    expect(loggableRequest<LoggedRequest>({ method: 'GET' })).toEqual({ method: 'GET' });
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

  it('logs requests with their loggable URL and headers only', () => {
    const { serializers } = httpLoggerOptions([]);

    expect(
      serializers?.['req']?.({
        url: '/api/family-codes/ABC234?returnTo=/x',
        headers: { host: 'site.example', referer: 'https://site.example/join/ABC234' },
        params: { splat: ['family-codes', 'ABC234'] },
      }),
    ).toEqual({ url: '/api/family-codes/[redacted]', headers: { host: 'site.example' } });
  });
});
