import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import {
  httpLoggerOptions,
  loggerOptions,
  secretValues,
  type SecretSettings,
} from './logger-options.js';

const settings: SecretSettings = {
  DATABASE_URL: 'postgresql://app:p%40ss-word@db.internal:5432/app',
  S3_ACCESS_KEY_ID: 'access-key-id',
  S3_SECRET_ACCESS_KEY: 'secret-access-key',
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

describe('secretValues', () => {
  it('lists the database URL, its password in both forms and the storage credentials', () => {
    expect(secretValues(settings)).toEqual([
      settings.DATABASE_URL,
      'p%40ss-word',
      'p@ss-word',
      'access-key-id',
      'secret-access-key',
    ]);
  });

  it('keeps a password whose percent escape cannot be decoded as written', () => {
    const malformed = { ...settings, DATABASE_URL: 'postgresql://app:p%zz@db.internal:5432/app' };

    expect(secretValues(malformed)).toEqual([
      malformed.DATABASE_URL,
      'p%zz',
      'p%zz',
      'access-key-id',
      'secret-access-key',
    ]);
  });
});

describe('loggerOptions', () => {
  it('redacts authorization headers, cookies and passwords', () => {
    const { logger, output } = captureLogs([]);

    logger.info({
      req: { headers: { authorization: 'Bearer token-1', cookie: 'session=cookie-1' } },
      res: { headers: { 'set-cookie': 'session=cookie-2' } },
      user: { password: 'password-1' },
    });

    expect(output()).toContain('[redacted]');
    for (const value of ['token-1', 'cookie-1', 'cookie-2', 'password-1']) {
      expect(output()).not.toContain(value);
    }
  });

  it('redacts fields named after secret variables', () => {
    const { logger, output } = captureLogs([]);

    logger.info({ config: { DATABASE_URL: 'url-1', S3_SECRET_ACCESS_KEY: 'key-1' } });

    expect(output()).not.toContain('url-1');
    expect(output()).not.toContain('key-1');
  });

  it('replaces secret values wherever they appear in a line', () => {
    const { logger, output } = captureLogs(secretValues(settings));

    logger.warn(
      { detail: `password p@ss-word for ${settings.DATABASE_URL}` },
      'using secret-access-key with access-key-id',
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

describe('httpLoggerOptions', () => {
  it('gives each request a fresh id and returns it in the X-Request-Id header', () => {
    const { genReqId } = httpLoggerOptions([]);
    const headers = new Map<string, unknown>();
    const response = {
      setHeader: (name: string, value: unknown) => headers.set(name, value),
    } as unknown as ServerResponse;

    const first = genReqId?.({} as IncomingMessage, response);
    const second = genReqId?.({} as IncomingMessage, response);

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(headers.get('X-Request-Id')).toBe(second);
  });
});
