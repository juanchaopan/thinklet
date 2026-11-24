import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  coverImportEnvironment,
  migrate,
  runBuiltCoverImport,
  startDatabase,
  startStorage,
  type StartedStorage,
} from '../support/containers.js';

// These tests run the built cover import (dist/rebuild.js) as `task rebuild`
// does in CD, and read everything it writes, as the job's log would show it.
describe('Cover import logs', () => {
  let database: StartedPostgreSqlContainer | undefined;
  let storage: StartedStorage | undefined;
  let databaseUrl: string;

  /** The import's environment with the shared database and storage, then the given changes. */
  function environmentWith(changes: Record<string, string> = {}): Record<string, string> {
    if (!storage) {
      throw new Error('Storage did not start');
    }
    return { ...coverImportEnvironment(databaseUrl, storage), ...changes };
  }

  /**
   * Asserts that the output holds none of the configured values that must
   * stay out of logs, nor any connection string or the storage endpoint.
   */
  function expectNothingConfigured(output: string, ...alsoSecret: string[]): void {
    const configured = environmentWith();
    const secretValues = [
      new URL(databaseUrl).password,
      configured['S3_ACCESS_KEY_ID'] ?? '',
      configured['S3_SECRET_ACCESS_KEY'] ?? '',
      ...alsoSecret,
    ];
    expect(secretValues.every((value) => value.length > 0)).toBe(true);
    expect(secretValues.filter((value) => output.includes(value))).toEqual([]);
    expect(output).not.toMatch(/postgres(ql)?:\/\//);
    expect(output.includes(configured['S3_ENDPOINT'] ?? '')).toBe(false);
  }

  beforeAll(async () => {
    database = await startDatabase();
    storage = await startStorage();
    databaseUrl = database.getConnectionUri();
    await migrate(databaseUrl);
  });

  afterAll(async () => {
    await Promise.all([database?.stop(), storage?.container.stop()]);
  });

  it('logs counts and nothing configured when it succeeds', async () => {
    const run = await runBuiltCoverImport(environmentWith());

    expect(run.exitCode).toBe(0);
    expect(run.output).toMatch(/Covers of \d+ books: \d+ uploaded, \d+ unchanged/);
    expectNothingConfigured(run.output);
  });

  it('names each book without a cover and exits with an error', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'thinklet-no-covers-'));
    try {
      const run = await runBuiltCoverImport(environmentWith({ BOOK_CONTENT_DIRECTORY: empty }));

      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('- book abc-songs: no cover.webp or cover.png');
      expectNothingConfigured(run.output);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('leaves the password out when the database refuses it', async () => {
    const url = new URL(databaseUrl);
    url.password = `wrong-${crypto.randomUUID()}`;

    const run = await runBuiltCoverImport(
      environmentWith({ MIGRATION_DATABASE_URL: url.toString(), DATABASE_URL: url.toString() }),
    );

    expect(run.exitCode).toBe(1);
    expectNothingConfigured(run.output, url.password);
  });

  it('leaves the keys out when storage refuses them', async () => {
    const wrongSecret = `wrong-${crypto.randomUUID()}`;

    const run = await runBuiltCoverImport(environmentWith({ S3_SECRET_ACCESS_KEY: wrongSecret }));

    expect(run.exitCode).toBe(1);
    expectNothingConfigured(run.output, wrongSecret);
  });

  it('refuses an invalid database URL, naming the variable without its value', async () => {
    const invalidValue = `not-a-url-${crypto.randomUUID()}`;

    const run = await runBuiltCoverImport(
      environmentWith({ MIGRATION_DATABASE_URL: invalidValue }),
    );

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain('MIGRATION_DATABASE_URL');
    expectNothingConfigured(run.output, invalidValue);
  });
});
