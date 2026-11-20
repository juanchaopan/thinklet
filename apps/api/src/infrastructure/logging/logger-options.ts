import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import type { Environment } from '../config/environment.js';

const CENSOR = '[redacted]';
const SECRET_VARIABLES = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

/** Log fields that are replaced wherever they appear. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  '*.*.password',
  ...SECRET_VARIABLES.flatMap((name) => [name, `*.${name}`]),
];

export type SecretSettings = Pick<
  Environment,
  'DATABASE_URL' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY'
>;

/**
 * The secret values of the configuration: the database URL, its password
 * (as written in the URL and decoded) and the storage credentials.
 */
export function secretValues(settings: SecretSettings): string[] {
  const { password } = new URL(settings.DATABASE_URL);
  return [
    settings.DATABASE_URL,
    password,
    decodeURIComponent(password),
    settings.S3_ACCESS_KEY_ID,
    settings.S3_SECRET_ACCESS_KEY,
  ];
}

/**
 * pino options that redact sensitive fields by path and, as a second line of
 * defence, replace every occurrence of a secret value in the written line,
 * whatever field or message it ended up in.
 */
export function loggerOptions(secrets: readonly string[]): LoggerOptions {
  const patterns = [...new Set(secrets.filter((secret) => secret.length > 0))]
    .map((secret) => JSON.stringify(secret).slice(1, -1))
    .sort((a, b) => b.length - a.length);

  return {
    redact: { paths: REDACTED_PATHS, censor: CENSOR },
    hooks: {
      streamWrite: (line) =>
        patterns.reduce((redacted, pattern) => redacted.replaceAll(pattern, CENSOR), line),
    },
  };
}

/** pino-http options: one JSON line per entry, each request tagged with a fresh request id. */
export function httpLoggerOptions(secrets: readonly string[]): Options {
  return {
    ...loggerOptions(secrets),
    genReqId: (_request: IncomingMessage, response: ServerResponse) => {
      const id = randomUUID();
      response.setHeader('X-Request-Id', id);
      return id;
    },
  };
}
