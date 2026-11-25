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
  'REDIS_URL',
  'OIDC_CLIENT_SECRET',
  'JWT_SIGNING_KEY',
  'CHILD_DATA_KEY',
  'AUTHING_USER_POOL_SECRET',
  'AUTHING_WEBHOOK_SECRET',
] as const;

/**
 * Fields that hold personal data (`.docs/design/data.md`): a parent's
 * email, the claims of an ID token and a parent's or the signed-in
 * parent's name; a child's nickname and account and the name of a device a
 * child is remembered on. `name` alone is not listed, because error
 * descriptions use it for the error's type.
 */
const PERSONAL_FIELDS = [
  'email',
  'claims',
  'parentName',
  'nickname',
  'account',
  'deviceName',
] as const;
const PERSONAL_NAME_PATHS = [
  'parent.name',
  'me.name',
  'device.name',
  '*.parent.name',
  '*.me.name',
  '*.device.name',
];

/**
 * Fields that hold a token or a cookie value of a login, or a family code,
 * which a child logs in with and lets whoever holds it apply to the family.
 */
const TOKEN_FIELDS = [
  'idToken',
  'id_token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'sessionToken',
  'loginToken',
  'deviceToken',
  'codeVerifier',
  'code_verifier',
  'token',
  'cookies',
  'familyCode',
] as const;

/** A field at the top level and up to two levels down. */
const atAnyDepth = (name: string) => [name, `*.${name}`, `*.*.${name}`];

/**
 * Log fields that are replaced wherever they appear. The request log keeps
 * only the headers of LOGGED_REQUEST_HEADERS; the request header paths here
 * still cover a request logged some other way, Authing's webhook secret
 * headers among them.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'req.headers["x-authing-webhook-secret"]',
  'req.headers["x-authing-token"]',
  'res.headers["set-cookie"]',
  // The login redirect carries the state, nonce and code challenge.
  'res.headers.location',
  ...atAnyDepth('password'),
  ...PERSONAL_FIELDS.flatMap(atAnyDepth),
  ...PERSONAL_NAME_PATHS,
  ...TOKEN_FIELDS.flatMap(atAnyDepth),
  ...SECRET_VARIABLES.flatMap((name) => [name, `*.${name}`]),
];

/**
 * The request headers the request log writes, in Node's lower case. Any
 * other header is left out, so a header nobody thought of is never logged:
 * `referer` carries the address of the page the request came from, such as
 * a join page with its family code or a QR login page with its token,
 * cookies and authorization carry the login, the webhook's secret header
 * proves a notification comes from Authing, and the forwarding headers
 * carry the client's IP address. These say which site and client sent the
 * request and what body it had, which is what tracing a failed request
 * needs.
 */
export const LOGGED_REQUEST_HEADERS: readonly string[] = [
  'host',
  'origin',
  'user-agent',
  'content-type',
  'content-length',
];

/**
 * Request paths with a segment that works as a credential on its own, so it
 * is replaced in the logged URL. Each pattern captures the path up to that
 * segment and matches the segment right after it, without regard to case,
 * as the router matches routes.
 */
const SENSITIVE_PATH_SEGMENTS: readonly RegExp[] = [
  // A family code lets whoever holds it apply to the family.
  /^(\/api\/family-codes\/)[^/]+/i,
  // The token of a login link logs its child in.
  /^(\/api\/child-login-links\/)[^/]+/i,
];

/**
 * The secret variables the api itself runs with: all of them but the
 * migration's database URL, which only the migration commands read.
 */
type ApiSecret = Exclude<(typeof SECRET_VARIABLES)[number], 'MIGRATION_DATABASE_URL'>;

/**
 * The api's secret settings, by the names of SECRET_VARIABLES; of the JWT
 * signing key only its private part is secret.
 */
export type SecretSettings = Pick<Environment, Exclude<ApiSecret, 'JWT_SIGNING_KEY'>> & {
  JWT_SIGNING_KEY: Pick<Environment['JWT_SIGNING_KEY'], 'd'>;
};

/** The password of a connection URL as written in it and decoded; none when it has none. */
function passwordsIn(url: string): string[] {
  const { password } = new URL(url);
  return password === '' ? [] : [password, decodePassword(password)];
}

/**
 * The values each secret setting can show up in a log line as. The type
 * asks for every secret variable of the api, so one added to
 * SECRET_VARIABLES is not left out of the values replaced in log lines.
 */
const SECRET_FORMS: { [Name in ApiSecret]: (value: SecretSettings[Name]) => string[] } = {
  DATABASE_URL: (url) => [url, ...passwordsIn(url)],
  S3_ACCESS_KEY_ID: (value) => [value],
  S3_SECRET_ACCESS_KEY: (value) => [value],
  REDIS_URL: (url) => [url, ...passwordsIn(url)],
  OIDC_CLIENT_SECRET: (value) => [value],
  JWT_SIGNING_KEY: (key) => [key.d],
  CHILD_DATA_KEY: (key) => [key.toString('base64'), key.toString('hex')],
  AUTHING_USER_POOL_SECRET: (value) => [value],
  AUTHING_WEBHOOK_SECRET: (value) => [value],
};

/** The names of the api's secret settings, in the order their values are listed. */
const SECRET_SETTINGS = Object.keys(SECRET_FORMS) as readonly ApiSecret[];

/** The values the secret setting `name` can show up in a log line as. */
function formsOf<Name extends ApiSecret>(name: Name, value: SecretSettings[Name]): string[] {
  return SECRET_FORMS[name](value);
}

/**
 * The secret values of the configuration: the database URL and its
 * password (as written in the URL and decoded), the storage credentials,
 * the Redis URL and its password, the OIDC client secret, the private part
 * of the JWT signing key, the child data key in base64, as the environment
 * holds it, and in hex, as bytes are most often printed, and Authing's user
 * pool secret and webhook secret.
 */
export function secretValues(settings: SecretSettings): string[] {
  return SECRET_SETTINGS.flatMap((name) => formsOf(name, settings[name]));
}

/**
 * The password with its percent escapes decoded. A `%` that starts no valid
 * escape cannot be decoded; the password is then kept as written, so the
 * logger still starts and the driver reports the URL itself.
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

/**
 * The URL as it may be logged: without its query string, because the login
 * callback's query carries the authorization code and the state and no
 * route takes personal data or tokens in the query, and with every
 * sensitive path segment replaced.
 */
export function loggableUrl(url: string): string {
  const start = url.indexOf('?');
  const path = start === -1 ? url : url.slice(0, start);
  return SENSITIVE_PATH_SEGMENTS.reduce(
    (redacted, pattern) => redacted.replace(pattern, `$1${CENSOR}`),
    path,
  );
}

/**
 * The headers of LOGGED_REQUEST_HEADERS that the request has, in a new
 * object: pino's standard serializer hands over the request's own headers,
 * which the application still reads.
 */
export function loggableHeaders(
  headers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    LOGGED_REQUEST_HEADERS.flatMap((name) =>
      headers[name] === undefined ? [] : [[name, headers[name]]],
    ),
  );
}

/** A request as pino's standard serializer writes it, before this module's changes. */
interface SerializedRequest {
  url?: string;
  headers?: Record<string, unknown>;
  query?: unknown;
  params?: unknown;
  remoteAddress?: unknown;
  remotePort?: unknown;
}

/**
 * The logged request with its URL made loggable, only the allowed headers,
 * and without the parsed query and route parameters or the address of the
 * connection. The parameters are those of the logging middleware's
 * catch-all route, which repeat every segment of the path, a sensitive one
 * included; the connection's address can be the client's IP address.
 */
export function loggableRequest<T extends SerializedRequest>(request: T): T {
  delete request.query;
  delete request.params;
  delete request.remoteAddress;
  delete request.remotePort;
  if (request.url !== undefined) {
    request.url = loggableUrl(request.url);
  }
  if (request.headers !== undefined) {
    request.headers = loggableHeaders(request.headers);
  }
  return request;
}

/**
 * pino-http options: one JSON line per entry, each request tagged with a
 * fresh request id and logged with a loggable URL and headers only.
 */
export function httpLoggerOptions(secrets: readonly string[]): Options {
  return {
    ...loggerOptions(secrets),
    serializers: { req: loggableRequest },
    genReqId: requestIdOf,
  };
}
