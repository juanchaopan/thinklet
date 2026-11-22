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
  CHILD_DATA_KEY: Buffer.from('child-data-key-for-logger-tests!'),
};

/** The child data key of `settings` in base64, as the environment holds it, and in hex. */
const childDataKeyBase64 = settings.CHILD_DATA_KEY.toString('base64');
const childDataKeyHex = settings.CHILD_DATA_KEY.toString('hex');

/** A login link token as the api makes them: 32 random bytes in base64url. */
const linkToken = 'q3V9-x_Z0aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567';

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
  it('lists the database URL, its password in both forms, the storage credentials, the client secret, the signing key and the child data key in both forms', () => {
    expect(secretValues(settings)).toEqual([
      settings.DATABASE_URL,
      'p%40ss-word',
      'p@ss-word',
      'access-key-id',
      'secret-access-key',
      'oidc-client-secret',
      'signing-key-d',
      childDataKeyBase64,
      childDataKeyHex,
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

  it("redacts a child's nickname, account and password and the names of their devices", () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      child: { nickname: 'nickname-1', account: 'account-1', password: 'password-1' },
      body: { child: { nickname: 'nickname-2', account: 'account-2' } },
      device: { name: 'device-1' },
      remembered: { device: { name: 'device-2' }, deviceName: 'device-3' },
      nickname: 'nickname-3',
      account: 'account-3',
    });

    for (const value of [
      'nickname-1',
      'nickname-2',
      'nickname-3',
      'account-1',
      'account-2',
      'account-3',
      'password-1',
      'device-1',
      'device-2',
      'device-3',
    ]) {
      expect(output()).not.toContain(value);
    }
  });

  it('keeps the name of an error, which is its type', () => {
    const { logger, output } = captureLogs([]);

    logger.warn({ error: { name: 'TypeError', message: 'bad input' } });

    expect(output()).toContain('TypeError');
  });

  it('redacts tokens of the login and family codes wherever they are nested', () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      idToken: 'token-1',
      tokens: { id_token: 'token-2', access_token: 'token-3', refresh_token: 'token-4' },
      login: { sessionToken: 'token-5', loginToken: 'token-6', codeVerifier: 'token-7' },
      request: { cookies: { thinklet_session: 'token-8' } },
      link: { token: 'token-9' },
      remembered: { deviceToken: 'token-10', child: { familyCode: 'token-11' } },
    });

    for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `token-${n}"`)) {
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
        CHILD_DATA_KEY: 'key-3',
      },
      CHILD_DATA_KEY: 'key-4',
    });

    for (const value of ['url-1', 'key-1', 'secret-1', 'key-2', 'key-3', 'key-4']) {
      expect(output()).not.toContain(value);
    }
  });

  it('replaces secret values wherever they appear in a line', () => {
    const { logger, output } = captureLogs(secretValues(settings));

    logger.warn(
      {
        detail: `password p@ss-word for ${settings.DATABASE_URL} and signing-key-d`,
        key: `${childDataKeyBase64} or ${childDataKeyHex}`,
      },
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

  it('replaces the token of a login link and keeps the action after it', () => {
    expect(loggableUrl(`/api/child-login-links/${linkToken}`)).toBe(
      '/api/child-login-links/[redacted]',
    );
    expect(loggableUrl(`/api/child-login-links/${linkToken}/password`)).toBe(
      '/api/child-login-links/[redacted]/password',
    );
    expect(loggableUrl(`/api/child-login-links/${linkToken}/login`)).toBe(
      '/api/child-login-links/[redacted]/login',
    );
  });

  it.each([
    [`/API/Child-Login-Links/${linkToken}`, '/API/Child-Login-Links/[redacted]'],
    [`/api/child-login-links/${linkToken}/`, '/api/child-login-links/[redacted]/'],
    [`/api/child-login-links/${linkToken}?token=${linkToken}`, '/api/child-login-links/[redacted]'],
    [
      `/api/child-login-links/${linkToken}/login?remember=${linkToken}`,
      '/api/child-login-links/[redacted]/login',
    ],
    [`/api/child-login-links/${encodeURIComponent('a/b')}`, '/api/child-login-links/[redacted]'],
  ])('replaces the login link token in %s', (url, logged) => {
    expect(loggableUrl(url)).toBe(logged);
    expect(loggableUrl(url)).not.toContain(linkToken);
  });

  it('keeps a path that only contains a sensitive prefix further on', () => {
    expect(loggableUrl('/api/me/family-codes/x')).toBe('/api/me/family-codes/x');
    expect(loggableUrl('/api/families/f-1/children/c-1/login-links/l-1')).toBe(
      '/api/families/f-1/children/c-1/login-links/l-1',
    );
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

  it('leaves out the address of a QR login page with its token', () => {
    const logged = loggableHeaders({
      host: 'site.example',
      referer: `https://site.example/child/qr/${linkToken}`,
    });

    expect(JSON.stringify(logged)).not.toContain(linkToken);
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

  it('logs a login link request without its token anywhere', () => {
    const { serializers } = httpLoggerOptions([]);

    const logged: unknown = serializers?.['req']?.({
      url: `/api/child-login-links/${linkToken}/password?x=${linkToken}`,
      headers: { host: 'site.example', referer: `https://site.example/child/qr/${linkToken}` },
      query: { x: linkToken },
      params: { splat: ['child-login-links', linkToken, 'password'] },
    });

    expect(logged).toEqual({
      url: '/api/child-login-links/[redacted]/password',
      headers: { host: 'site.example' },
    });
    expect(JSON.stringify(logged)).not.toContain(linkToken);
  });
});
