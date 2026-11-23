import { execFile } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const supportDirectory = dirname(fileURLToPath(import.meta.url));
export const apiDirectory = join(supportDirectory, '..', '..');
const composeFile = join(apiDirectory, '..', '..', 'docker-compose.yml');
const S3_PORT = 8333;
const OIDC_PORT = 8080;
/** The mock OIDC provider serves an issuer under any first path segment; tests use this one. */
const OIDC_ISSUER_ID = 'default';
/** Where the provider's login page is copied to in its container. */
const OIDC_LOGIN_PAGE = '/login/login.html';

/** The site origin of tests that run no web server in front of the api. */
export const TEST_APP_ORIGIN = 'http://localhost:4200';

/** Image references are read from docker-compose.yml so tests and development use the same pinned images. */
function composeImage(name: string): string {
  const match = new RegExp(`^\\s*image:\\s*['"]?((?:\\S+/)?${name}:\\S+?)['"]?\\s*$`, 'm').exec(
    readFileSync(composeFile, 'utf8'),
  );
  if (!match?.[1]) {
    throw new Error(`No ${name} image in docker-compose.yml`);
  }
  return match[1];
}

/** A throwaway PostgreSQL with a random password on a random host port. */
export async function startDatabase(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(composeImage('postgres'))
    .withDatabase('thinklet')
    .withUsername('thinklet')
    .withPassword(`pw-${randomUUID()}`)
    .start();
}

export interface StartedStorage {
  container: StartedTestContainer;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** A throwaway SeaweedFS serving S3 with random credentials and one bucket created at start. */
export async function startStorage(): Promise<StartedStorage> {
  const bucket = `bucket-${randomUUID()}`;
  const accessKeyId = `key-${randomUUID()}`;
  const secretAccessKey = `secret-${randomUUID()}`;
  const container = await new GenericContainer(composeImage('seaweedfs'))
    .withEnvironment({ AWS_ACCESS_KEY_ID: accessKeyId, AWS_SECRET_ACCESS_KEY: secretAccessKey })
    .withCommand(['mini', '-dir=/data', `-bucket=${bucket}`])
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(Wait.forLogMessage(`created bucket ${bucket}`))
    .start();
  return {
    container,
    endpoint: `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

/** The OIDC provider and the client the api signs in through. */
export interface OidcClient {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export interface StartedOidcProvider extends OidcClient {
  container: StartedTestContainer;
}

/**
 * A throwaway mock OIDC provider on a random host port with the interactive
 * login page on, so a browser can sign in as any user. It accepts any client,
 * so the client id and secret are random. The issuer is on the host the tests
 * reach the container at, the one address both the browser and the api use.
 *
 * The login page is mock-login.html, the same form with nothing outside the
 * page: the provider's own page loads its font from Google Fonts, and the
 * browser's load event, which every sign-in waits for, then hangs for as
 * long as that site is slow or out of reach.
 */
export async function startOidcProvider(): Promise<StartedOidcProvider> {
  const container = await new GenericContainer(composeImage('mock-oauth2-server'))
    .withEnvironment({
      JSON_CONFIG: JSON.stringify({ interactiveLogin: true, loginPagePath: OIDC_LOGIN_PAGE }),
    })
    .withCopyContentToContainer([
      {
        content: readFileSync(join(supportDirectory, 'mock-login.html'), 'utf8'),
        target: OIDC_LOGIN_PAGE,
      },
    ])
    .withExposedPorts(OIDC_PORT)
    .withWaitStrategy(Wait.forHttp('/isalive', OIDC_PORT).forStatusCode(200))
    .start();
  return {
    container,
    issuer: `http://${container.getHost()}:${container.getMappedPort(OIDC_PORT)}/${OIDC_ISSUER_ID}`,
    clientId: `client-${randomUUID()}`,
    clientSecret: `secret-${randomUUID()}`,
  };
}

/** Every service the api runs against, each in its own throwaway container. */
export interface StartedServices {
  database: StartedPostgreSqlContainer;
  storage: StartedStorage;
  oidc: StartedOidcProvider;
  /** Stops and removes the containers. */
  stop: () => Promise<void>;
}

/** The value of a settled promise, or its failure thrown. */
function valueOf<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') {
    throw result.reason;
  }
  return result.value;
}

/**
 * Starts the database, the storage and the OIDC provider side by side. When
 * one of them fails to start, the others are stopped before the failure is
 * thrown, so none is left running.
 */
export async function startServices(): Promise<StartedServices> {
  const [database, storage, oidc] = await Promise.allSettled([
    startDatabase(),
    startStorage(),
    startOidcProvider(),
  ]);
  const containers: StartedTestContainer[] = [];
  if (database.status === 'fulfilled') {
    containers.push(database.value);
  }
  for (const started of [storage, oidc]) {
    if (started.status === 'fulfilled') {
      containers.push(started.value.container);
    }
  }
  const stop = async () => {
    await Promise.all(containers.map((container) => container.stop()));
  };
  try {
    return { database: valueOf(database), storage: valueOf(storage), oidc: valueOf(oidc), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A new ES256 private key as a JWK with a random key id, in the JSON form JWT_SIGNING_KEY takes. */
export function newSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return JSON.stringify({
    ...privateKey.export({ format: 'jwk' }),
    kid: `test-${randomUUID()}`,
    alg: 'ES256',
  });
}

/**
 * The signing key of every api this test run starts, made once per process,
 * so those apis accept each other's JWTs.
 */
export const testSigningKey = newSigningKey();

/**
 * The child data key of every api this test run starts, 32 random bytes in
 * the base64 form CHILD_DATA_KEY takes, made once per process, so those apis
 * read each other's encrypted child data.
 */
export const testChildDataKey = randomBytes(32).toString('base64');

/** The api's environment variables for the given database, storage, OIDC client and site origin. */
export function apiEnvironment(
  databaseUrl: string,
  storage: Omit<StartedStorage, 'container'>,
  oidc: OidcClient,
  appOrigin = TEST_APP_ORIGIN,
): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    S3_ENDPOINT: storage.endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: storage.bucket,
    S3_ACCESS_KEY_ID: storage.accessKeyId,
    S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
    S3_FORCE_PATH_STYLE: 'true',
    OIDC_ISSUER: oidc.issuer,
    OIDC_CLIENT_ID: oidc.clientId,
    OIDC_CLIENT_SECRET: oidc.clientSecret,
    APP_ORIGIN: appOrigin,
    JWT_SIGNING_KEY: testSigningKey,
    CHILD_DATA_KEY: testChildDataKey,
  };
}

const drizzleKit = join(
  dirname(createRequire(join(apiDirectory, 'package.json')).resolve('drizzle-kit')),
  'bin.cjs',
);

/** Runs `drizzle-kit migrate` from apps/api against the given database. */
export async function migrate(databaseUrl: string): Promise<void> {
  await promisify(execFile)(process.execPath, [drizzleKit, 'migrate'], {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl },
  });
}
