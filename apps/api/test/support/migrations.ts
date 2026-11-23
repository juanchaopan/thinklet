import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as migrateFolder } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { apiDirectory, startDatabase } from './containers.js';

const migrationsDirectory = join(apiDirectory, 'drizzle');

interface JournalEntry {
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

/** drizzle-kit's record of the migration scripts, in the order they apply. */
export function readJournal(): Journal {
  return JSON.parse(
    readFileSync(join(migrationsDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
}

/**
 * Brings the database to the version just before the migration with the
 * given tag: every earlier script is applied and recorded in
 * `__drizzle_migrations`, as `drizzle-kit migrate` does, so a later
 * `drizzle-kit migrate` applies the rest. drizzle-kit always reads the whole
 * apps/api/drizzle/ folder, so the earlier scripts are copied to a folder of
 * their own and applied with the Drizzle migrator drizzle-kit runs on.
 */
export async function migrateBefore(databaseUrl: string, tag: string): Promise<void> {
  const journal = readJournal();
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index === -1) {
    throw new Error(`No migration ${tag} in the journal`);
  }
  const earlier = journal.entries.slice(0, index);
  const folder = mkdtempSync(join(tmpdir(), 'thinklet-migrations-'));
  try {
    mkdirSync(join(folder, 'meta'));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: earlier }),
    );
    for (const entry of earlier) {
      copyFileSync(join(migrationsDirectory, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await migrateFolder(drizzle(client), { migrationsFolder: folder });
    } finally {
      await client.end();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export interface DatabaseBefore {
  database: StartedPostgreSqlContainer;
  /** The connection URL, for `drizzle-kit migrate`. */
  url: string;
  /** A client connected to the database, for the test's own SQL. */
  client: Client;
}

/**
 * Starts a throwaway database at the version just before the migration
 * with the given tag, with a client connected to it, so a test can write
 * data in the earlier format before it migrates.
 */
export async function startDatabaseBefore(tag: string): Promise<DatabaseBefore> {
  const database = await startDatabase();
  try {
    const url = database.getConnectionUri();
    await migrateBefore(url, tag);
    const client = new Client({ connectionString: url });
    await client.connect();
    return { database, url, client };
  } catch (error) {
    await database.stop();
    throw error;
  }
}
