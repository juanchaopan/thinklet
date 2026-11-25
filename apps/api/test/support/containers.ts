import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const supportDirectory = dirname(fileURLToPath(import.meta.url));
export const apiDirectory = join(supportDirectory, '..', '..');
const repositoryRoot = join(apiDirectory, '..', '..');
const composeFile = join(repositoryRoot, 'docker-compose.yml');
const S3_PORT = 8333;
const REDIS_PORT = 6379;
const OIDC_PORT = 8080;
/** The mock OIDC provider serves an issuer under any first path segment; tests use this one. */
const OIDC_ISSUER_ID = 'default';
/** Where the provider's login page is copied to in its container. */
const OIDC_LOGIN_PAGE = '/login/login.html';

/** The site origin of tests that run no web server in front of the api. */
export const TEST_APP_ORIGIN = 'http://localhost:4200';

/**
 * The request header the api under test takes the client's IP address from,
 * as on a development machine. Nothing in front of the api sets it, so a
 * test that needs a source sends this header itself.
 */
export const TEST_CLIENT_IP_HEADER = 'x-forwarded-for';

/** The repository's book folders, which every test environment imports the covers from. */
export const bookContentDirectory = join(repositoryRoot, 'content', 'books');

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

/** Where a test's storage is and how to sign in to it. */
export type StorageAccess = Omit<StartedStorage, 'container'>;

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

export interface StartedRedis {
  container: StartedTestContainer;
  /** The redis:// address, with the password, that the api connects to. */
  url: string;
}

/**
 * A throwaway Valkey, which speaks the Redis protocol, with a random
 * password on a random host port, as staging's Redis takes one.
 */
export async function startRedis(): Promise<StartedRedis> {
  const password = `pw-${randomUUID()}`;
  const container = await new GenericContainer(composeImage('valkey'))
    .withCommand(['valkey-server', '--requirepass', password])
    .withExposedPorts(REDIS_PORT)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  return {
    container,
    url: `redis://:${password}@${container.getHost()}:${container.getMappedPort(REDIS_PORT)}`,
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
  redis: StartedRedis;
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
 * Starts the database, the storage, Redis and the OIDC provider side by
 * side. When one of them fails to start, the others are stopped before the
 * failure is thrown, so none is left running.
 */
export async function startServices(): Promise<StartedServices> {
  const [database, storage, redis, oidc] = await Promise.allSettled([
    startDatabase(),
    startStorage(),
    startRedis(),
    startOidcProvider(),
  ]);
  const containers: StartedTestContainer[] = [];
  if (database.status === 'fulfilled') {
    containers.push(database.value);
  }
  for (const started of [storage, redis, oidc]) {
    if (started.status === 'fulfilled') {
      containers.push(started.value.container);
    }
  }
  const stop = async () => {
    await Promise.all(containers.map((container) => container.stop()));
  };
  try {
    return {
      database: valueOf(database),
      storage: valueOf(storage),
      redis: valueOf(redis),
      oidc: valueOf(oidc),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Where the api under test finds each service it runs against. */
export interface ServiceAccess {
  databaseUrl: string;
  storage: StorageAccess;
  oidc: OidcClient;
  redisUrl: string;
}

/**
 * How the api reaches the started services. A test that points the api at
 * a broken or missing service overrides that one field.
 */
export function accessTo(services: StartedServices): ServiceAccess {
  return {
    databaseUrl: services.database.getConnectionUri(),
    storage: services.storage,
    oidc: services.oidc,
    redisUrl: services.redis.url,
  };
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
 * The child data key of every api and data migration this test run starts,
 * 32 random bytes in the base64 form CHILD_DATA_KEY takes, made once per
 * process, so those apis read each other's encrypted child data and what
 * the data migrations wrote.
 */
export const testChildDataKey = randomBytes(32).toString('base64');

/** The S3_* variables for the given storage. */
function storageEnvironment(storage: StorageAccess): Record<string, string> {
  return {
    S3_ENDPOINT: storage.endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: storage.bucket,
    S3_ACCESS_KEY_ID: storage.accessKeyId,
    S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
    S3_FORCE_PATH_STYLE: 'true',
  };
}

/** The api's environment variables for the given services and site origin. */
export function apiEnvironment(
  access: ServiceAccess,
  appOrigin = TEST_APP_ORIGIN,
): Record<string, string> {
  return {
    DATABASE_URL: access.databaseUrl,
    ...storageEnvironment(access.storage),
    REDIS_URL: access.redisUrl,
    CLIENT_IP_HEADER: TEST_CLIENT_IP_HEADER,
    OIDC_ISSUER: access.oidc.issuer,
    OIDC_CLIENT_ID: access.oidc.clientId,
    OIDC_CLIENT_SECRET: access.oidc.clientSecret,
    APP_ORIGIN: appOrigin,
    JWT_SIGNING_KEY: testSigningKey,
    CHILD_DATA_KEY: testChildDataKey,
  };
}

/**
 * The database variables of a command that runs after the migrations.
 * MIGRATION_DATABASE_URL is set as well because the commands prefer it, and
 * a test run through Task has it from the local .env file, pointing at the
 * development database.
 */
function commandDatabase(databaseUrl: string): Record<string, string> {
  return { DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl };
}

/** The cover import's environment variables for the given database, storage and book folders. */
export function coverImportEnvironment(
  databaseUrl: string,
  storage: StorageAccess,
  contentDirectory = bookContentDirectory,
): Record<string, string> {
  return {
    ...commandDatabase(databaseUrl),
    ...storageEnvironment(storage),
    BOOK_CONTENT_DIRECTORY: contentDirectory,
  };
}

/** The data migrations' environment variables for the given database, with the tests' child data key. */
export function dataMigrationEnvironment(databaseUrl: string): Record<string, string> {
  return { ...commandDatabase(databaseUrl), CHILD_DATA_KEY: testChildDataKey };
}

const drizzleKit = join(
  dirname(createRequire(join(apiDirectory, 'package.json')).resolve('drizzle-kit')),
  'bin.cjs',
);

/**
 * Runs `drizzle-kit migrate` from apps/api against the given database, the
 * first step of `task migrate`: the migration scripts alone.
 */
export async function migrateSchema(databaseUrl: string): Promise<void> {
  await promisify(execFile)(process.execPath, [drizzleKit, 'migrate'], {
    cwd: apiDirectory,
    env: { ...process.env, ...commandDatabase(databaseUrl) },
  });
}

/** A started built entry point of the api and what it has written. */
export interface BuiltProcess {
  child: ChildProcess;
  /** Everything the process wrote to stdout and stderr so far. */
  output: () => string;
}

/**
 * Runs a built entry point of the api (`dist/<file>`) as a separate process
 * with only the given variables, plus what the OS needs to start it.
 */
export function spawnBuiltEntry(file: string, environment: Record<string, string>): BuiltProcess {
  const chunks: Buffer[] = [];
  const child = spawn(process.execPath, [join(apiDirectory, 'dist', file)], {
    cwd: apiDirectory,
    env: {
      PATH: process.env['PATH'] ?? '',
      SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
  return { child, output: () => Buffer.concat(chunks).toString('utf8') };
}

/** How a run of a built command ended. */
export interface CommandRun {
  exitCode: number | null;
  /** Everything it wrote to stdout and stderr. */
  output: string;
}

/** Runs a built command of the api (`dist/<file>`) to its end. */
async function runBuiltCommand(
  file: string,
  environment: Record<string, string>,
): Promise<CommandRun> {
  const { child, output } = spawnBuiltEntry(file, environment);
  // 'close' comes after both streams have ended, so the output is whole.
  const [exitCode] = (await once(child, 'close')) as [number | null];
  return { exitCode, output: output() };
}

/** Throws when the built command did not succeed, with everything it wrote. */
function expectSuccess(command: string, run: CommandRun): void {
  if (run.exitCode !== 0) {
    throw new Error(`The ${command} exited with code ${run.exitCode}:\n${run.output}`);
  }
}

/** Runs the built data migrations (dist/migrate-data.js), the second step of `task migrate`. */
export function runBuiltDataMigrations(databaseUrl: string): Promise<CommandRun> {
  return runBuiltCommand('migrate-data.js', dataMigrationEnvironment(databaseUrl));
}

/**
 * Migrates the given database as `task migrate` does: `drizzle-kit migrate`,
 * then the built data migrations with the tests' child data key. The api
 * must be built first.
 */
export async function migrate(databaseUrl: string): Promise<void> {
  await migrateSchema(databaseUrl);
  expectSuccess('data migration', await runBuiltDataMigrations(databaseUrl));
}

/** Runs the built cover import (dist/rebuild.js), as `task rebuild` does, to its end. */
export function runBuiltCoverImport(environment: Record<string, string>): Promise<CommandRun> {
  return runBuiltCommand('rebuild.js', environment);
}

/**
 * Imports the repository's covers into the database and storage with the
 * built cover import, as every environment does after its migrations.
 */
export async function importBuiltCovers(
  databaseUrl: string,
  storage: StorageAccess,
): Promise<void> {
  expectSuccess(
    'cover import',
    await runBuiltCoverImport(coverImportEnvironment(databaseUrl, storage)),
  );
}
