import { randomUUID } from 'node:crypto';
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

/** Where the migration with the tag stands in the journal; throws when it is not there. */
function indexOf(journal: Journal, tag: string): number {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index === -1) {
    throw new Error(`No migration ${tag} in the journal`);
  }
  return index;
}

/**
 * Applies the first `count` scripts of the journal and records them in
 * `__drizzle_migrations`, as `drizzle-kit migrate` does, so a later
 * `drizzle-kit migrate` applies the rest. drizzle-kit always reads the whole
 * apps/api/drizzle/ folder, so the scripts are copied to a folder of their
 * own and applied with the Drizzle migrator drizzle-kit runs on.
 */
async function applyFirst(databaseUrl: string, count: number): Promise<void> {
  const journal = readJournal();
  const applied = journal.entries.slice(0, count);
  const folder = mkdtempSync(join(tmpdir(), 'thinklet-migrations-'));
  try {
    mkdirSync(join(folder, 'meta'));
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({ ...journal, entries: applied }),
    );
    for (const entry of applied) {
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

/** Brings the database to the version just before the migration with the given tag. */
export async function migrateBefore(databaseUrl: string, tag: string): Promise<void> {
  await applyFirst(databaseUrl, indexOf(readJournal(), tag));
}

/**
 * Brings the database to the version of the migration with the given tag,
 * and no further, for the test of that migration: the scripts after it may
 * change what it made.
 */
export async function migrateThrough(databaseUrl: string, tag: string): Promise<void> {
  await applyFirst(databaseUrl, indexOf(readJournal(), tag) + 1);
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

/**
 * The raw SQL a migration test reads and writes its rows with, before and
 * after the migration. The client is asked for on every query, so the
 * helpers can be made before the test's database is up.
 */
export function migrationRows(client: () => Client) {
  async function rows<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await client().query<T>(text, values)).rows;
  }

  /** The id of the single row an insert returns. */
  async function insertedId(text: string, values: unknown[]): Promise<string> {
    const [row] = await rows<{ id: string }>(text, values);
    if (!row) {
      throw new Error('Nothing was inserted');
    }
    return row.id;
  }

  /** The SQLSTATE a statement fails with, or undefined when it succeeds. */
  async function failureOf(text: string, values: unknown[]): Promise<string | undefined> {
    try {
      await client().query(text, values);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  /** A parent with a new Authing subject. */
  function newParent(): Promise<string> {
    return insertedId(
      `insert into parents (oidc_issuer, oidc_subject, name, consent_version, consented_at)
       values ('https://issuer.example', $1, '林悦', '2026-11-21', now()) returning id`,
      [randomUUID()],
    );
  }

  /** A family with the code, or with a code of its own. */
  function newFamily(code = randomUUID().slice(0, 6).toUpperCase()): Promise<string> {
    return insertedId(
      `insert into families (name, timezone, code) values ('林悦的家', 'Asia/Shanghai', $1) returning id`,
      [code],
    );
  }

  return { rows, insertedId, failureOf, newParent, newFamily };
}
