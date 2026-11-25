import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../infrastructure/database/database.module.js';
import { dataMigrations } from '../infrastructure/database/schema.js';
import type { DataMigration } from './data-migration.js';

/** The form of a data migration's name: four digits of version, a hyphen and lower-case words joined by hyphens. */
const NAME_PATTERN = String.raw`\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*`;

/** A data migration's name. */
const NAME = new RegExp(`^${NAME_PATTERN}$`);

/** A data migration's file: its name and `.ts`. Tests, `*.spec.ts`, do not match. */
const FILE = new RegExp(`^(${NAME_PATTERN})\\.ts$`);

/**
 * The data migrations cannot run as they are: a file and the registry
 * disagree, a migration that ran has changed or is gone, or a new one comes
 * before one that ran. The message names migrations and files only.
 */
export class DataMigrationError extends Error {
  override readonly name = 'DataMigrationError';
}

/**
 * The checksum of a migration's source: the SHA-256 in hex of its text with
 * line endings as LF, so a checkout that writes CRLF gives the same value.
 */
export function checksumOf(source: string): string {
  return createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
}

/** A registered migration with the checksum of its file. */
interface PlannedMigration<Context> {
  migration: DataMigration<Context>;
  checksum: string;
}

/** A migration that has run, as `data_migrations` records it. */
interface RanMigration {
  name: string;
  checksum: string;
}

const ranColumns = { name: dataMigrations.name, checksum: dataMigrations.checksum };

/** The checksum of every migration file in the directory, by name. */
function readSources(sourceDirectory: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of readdirSync(sourceDirectory).sort()) {
    const name = FILE.exec(file)?.[1];
    if (name !== undefined) {
      sources.set(name, checksumOf(readFileSync(join(sourceDirectory, file), 'utf8')));
    }
  }
  return sources;
}

/**
 * The registered migrations with their checksums, after checking that the
 * names are well formed and in ascending order, and that the registry and
 * the files name the same migrations.
 */
function plan<Context>(
  migrations: ReadonlyArray<DataMigration<Context>>,
  sourceDirectory: string,
): Array<PlannedMigration<Context>> {
  const sources = readSources(sourceDirectory);
  const planned: Array<PlannedMigration<Context>> = [];
  let previous = '';
  for (const migration of migrations) {
    if (!NAME.test(migration.name)) {
      throw new DataMigrationError(`Data migration name ${migration.name} is not well formed`);
    }
    if (migration.name <= previous) {
      throw new DataMigrationError(
        `Data migration ${migration.name} is registered after ${previous}; register them in ascending order`,
      );
    }
    const checksum = sources.get(migration.name);
    if (checksum === undefined) {
      throw new DataMigrationError(
        `Data migration ${migration.name} has no file ${migration.name}.ts`,
      );
    }
    planned.push({ migration, checksum });
    previous = migration.name;
  }
  for (const name of sources.keys()) {
    if (!migrations.some((migration) => migration.name === name)) {
      throw new DataMigrationError(`Data migration file ${name}.ts is not in the registry`);
    }
  }
  return planned;
}

/** Throws when the migration recorded as run has another checksum than its file now. */
function checkUnchanged(row: RanMigration, checksum: string | undefined): void {
  if (checksum === undefined) {
    throw new DataMigrationError(`Data migration ${row.name} has run but is no longer registered`);
  }
  if (checksum !== row.checksum) {
    throw new DataMigrationError(
      `Data migration ${row.name} has changed since it ran; write a new migration instead`,
    );
  }
}

/**
 * Checks what has run against what is planned: every migration that ran is
 * still there, unchanged, and every one still to run comes after the last
 * one that ran. Returns the migrations still to run, in order.
 */
function pending<Context>(
  planned: Array<PlannedMigration<Context>>,
  ran: RanMigration[],
): Array<PlannedMigration<Context>> {
  const checksums = new Map(planned.map((entry) => [entry.migration.name, entry.checksum]));
  for (const row of ran) {
    checkUnchanged(row, checksums.get(row.name));
  }
  const ranNames = new Set(ran.map((row) => row.name));
  const lastRan = [...ranNames].sort().at(-1) ?? '';
  const toRun = planned.filter((entry) => !ranNames.has(entry.migration.name));
  const early = toRun.find((entry) => entry.migration.name < lastRan);
  if (early !== undefined) {
    throw new DataMigrationError(
      `Data migration ${early.migration.name} comes before ${lastRan}, which has run already`,
    );
  }
  return toRun;
}

export interface DataMigrationRun<Context> {
  database: Database;
  /** The registered migrations, in the order they run. */
  migrations: ReadonlyArray<DataMigration<Context>>;
  /** The folder of the migrations' TypeScript files, whose checksums are recorded. */
  sourceDirectory: string;
  context: Context;
}

/**
 * Runs the data migrations that have not run yet, in order, each in a
 * transaction of its own that also records it in `data_migrations` with
 * the checksum of its file and when it finished. Before anything runs, it
 * checks the registry against the files and against what has run, and
 * throws DataMigrationError when one that ran has changed or is gone, so
 * nothing runs on top of a history that differs from the code. A migration
 * that throws rolls back with its record, and the ones after it do not run.
 *
 * Each transaction locks `data_migrations` and reads the migration's record
 * again under the lock, so of two runs at once only one applies a
 * migration. Returns the names of the migrations this run applied.
 */
export async function applyDataMigrations<Context>(
  run: DataMigrationRun<Context>,
): Promise<string[]> {
  const planned = plan(run.migrations, run.sourceDirectory);
  const ran = await run.database.select(ranColumns).from(dataMigrations);
  const applied: string[] = [];
  for (const { migration, checksum } of pending(planned, ran)) {
    const didRun = await run.database.transaction(async (transaction) => {
      await transaction.execute(sql`lock table ${dataMigrations} in exclusive mode`);
      const recorded = (
        await transaction
          .select(ranColumns)
          .from(dataMigrations)
          .where(eq(dataMigrations.name, migration.name))
      ).at(0);
      if (recorded !== undefined) {
        checkUnchanged(recorded, checksum);
        return false;
      }
      await migration.run(transaction, run.context);
      await transaction
        .insert(dataMigrations)
        .values({ name: migration.name, checksum, ranAt: sql`clock_timestamp()` });
      return true;
    });
    if (didRun) {
      applied.push(migration.name);
    }
  }
  return applied;
}
