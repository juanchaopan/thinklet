import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export const apiDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const composeFile = join(apiDirectory, '..', '..', 'docker-compose.yml');
const S3_PORT = 8333;

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

/** The api's environment variables for the given database and storage. */
export function apiEnvironment(
  databaseUrl: string,
  storage: Omit<StartedStorage, 'container'>,
): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    S3_ENDPOINT: storage.endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: storage.bucket,
    S3_ACCESS_KEY_ID: storage.accessKeyId,
    S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
    S3_FORCE_PATH_STYLE: 'true',
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
