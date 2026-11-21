import type { LoggerOptions } from 'pino';
import type { Options } from 'pino-http';
import type { Environment } from '../config/environment.js';
import { requestIdOf } from './request-id.js';

const CENSOR = '[redacted]';
const SECRET_VARIABLES = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'OIDC_CLIENT_SECRET',
  'JWT_SIGNING_KEY',
] as const;

/**
 * Fields that hold a parent's personal data (`.docs/design/data.md`): the
 * email, the claims of an ID token, and a parent's or the signed-in
 * parent's name. `name` alone is not listed, because error descriptions
 * use it for the error's type.
 */
const PERSONAL_FIELDS = ['email', 'claims', 'parentName'] as const;
const PERSONAL_NAME_PATHS = ['parent.name', 'me.name', '*.parent.name', '*.me.name'];

/** Fields that hold a token or a cookie value of the login. */
const TOKEN_FIELDS = [
  'idToken',
  'id_token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'sessionToken',
  'loginToken',
  'codeVerifier',
  'code_verifier',
  'token',
  'cookies',
] as const;

/** A field at the top level and up to two levels down. */
const atAnyDepth = (name: string) => [name, `*.${name}`, `*.*.${name}`];

/** Log fields that are replaced wherever they appear. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // The login redirect carries the state, nonce and code challenge.
  'res.headers.location',
  ...atAnyDepth('password'),
  ...PERSONAL_FIELDS.flatMap(atAnyDepth),
  ...PERSONAL_NAME_PATHS,
  ...TOKEN_FIELDS.flatMap(atAnyDepth),
  ...SECRET_VARIABLES.flatMap((name) => [name, `*.${name}`]),
];

export type SecretSettings = Pick<
  Environment,
  'DATABASE_URL' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'OIDC_CLIENT_SECRET'
> & { JWT_SIGNING_KEY: Pick<Environment['JWT_SIGNING_KEY'], 'd'> };

/**
 * The secret values of the configuration: the database URL, its password
 * (as written in the URL and decoded), the storage credentials, the OIDC
 * client secret and the private part of the JWT signing key.
 */
export function secretValues(settings: SecretSettings): string[] {
  const { password } = new URL(settings.DATABASE_URL);
  return [
    settings.DATABASE_URL,
    password,
    decodePassword(password),
    settings.S3_ACCESS_KEY_ID,
    settings.S3_SECRET_ACCESS_KEY,
    settings.OIDC_CLIENT_SECRET,
    settings.JWT_SIGNING_KEY.d,
  ];
}

/**
 * The password with its percent escapes decoded. A `%` that starts no valid
 * escape cannot be decoded; the password is then kept as written, so the
 * logger still starts and the database driver reports the URL itself.
 */
function decodePassword(password: string): string {
  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
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

/** A request as pino's standard serializer writes it, before this module's changes. */
interface SerializedRequest {
  url?: string;
  query?: unknown;
}

/**
 * The logged request without its query string: the login callback's query
 * carries the authorization code and the state, and no route takes personal
 * data or tokens in the query, so none is logged.
 */
export function withoutQuery<T extends SerializedRequest>(request: T): T {
  delete request.query;
  if (request.url !== undefined) {
    const start = request.url.indexOf('?');
    request.url = start === -1 ? request.url : request.url.slice(0, start);
  }
  return request;
}

/**
 * pino-http options: one JSON line per entry, each request tagged with a
 * fresh request id and logged without its query string.
 */
export function httpLoggerOptions(secrets: readonly string[]): Options {
  return {
    ...loggerOptions(secrets),
    serializers: { req: withoutQuery },
    genReqId: requestIdOf,
  };
}
