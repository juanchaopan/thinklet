import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  applyDataMigrations,
  checksumOf,
  DataMigrationError,
} from '../../src/data-migrations/apply-data-migrations.js';
import type { DataMigration } from '../../src/data-migrations/data-migration.js';
import type { Database } from '../../src/infrastructure/database/database.module.js';
import * as schema from '../../src/infrastructure/database/schema.js';
import { migrateSchema, startDatabase } from '../support/containers.js';
import { query } from '../support/database.js';

/** What the made-up migrations hand each other: nothing, as they only write to their log. */
type NoContext = Record<string, never>;

type Migrations = Array<DataMigration<NoContext>>;

// The data migration runner on a real database at the latest schema, with
// made-up migrations whose files are written to a folder of the test's own.
// Each made-up migration writes its name to a log table in its transaction,
// so the log shows what ran, in which order, and what was rolled back.
describe('the data migration runner', () => {
  let container: StartedPostgreSqlContainer;
  let url: string;
  let pool: Pool;
  let database: Database;
  let sourceDirectory: string;

  /** A migration that logs its name, then throws when told to. */
  function logging(name: string, fail = false): DataMigration<NoContext> {
    return {
      name,
      async run(transaction) {
        await transaction.execute(sql`insert into runner_log (name) values (${name})`);
        if (fail) {
          throw new Error(`${name} failed`);
        }
      },
    };
  }

  /** Writes the migration's file, with text that stands for its code. */
  function writeSource(name: string, text = `// ${name}\n`): void {
    writeFileSync(join(sourceDirectory, `${name}.ts`), text);
  }

  const apply = (migrations: Migrations) =>
    applyDataMigrations({ database, migrations, sourceDirectory, context: {} });

  const logged = async () =>
    (await query<{ name: string }>(url, 'select name from runner_log order by id')).map(
      ({ name }) => name,
    );

  const recorded = () =>
    query<{ name: string; checksum: string; ran_at: Date }>(
      url,
      'select name, checksum, ran_at from data_migrations order by name',
    );

  /** Asserts that exactly these migrations ran, in this order, and are recorded. */
  async function expectRan(names: string[]): Promise<void> {
    expect(await logged()).toEqual(names);
    expect((await recorded()).map(({ name }) => name)).toEqual(names);
  }

  beforeAll(async () => {
    container = await startDatabase();
    url = container.getConnectionUri();
    await migrateSchema(url);
    await query(url, 'create table runner_log (id serial primary key, name text not null)');
    pool = new Pool({ connectionString: url });
    database = drizzle({ client: pool, schema });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    sourceDirectory = mkdtempSync(join(tmpdir(), 'thinklet-data-migrations-'));
    await query(url, 'truncate runner_log, data_migrations');
  });

  afterEach(() => {
    rmSync(sourceDirectory, { recursive: true, force: true });
  });

  it('runs the migrations in order and records each with the checksum of its file', async () => {
    writeSource('0001-first', '// first\r\n');
    writeSource('0002-second');
    const before = Date.now();

    const applied = await apply([logging('0001-first'), logging('0002-second')]);

    expect(applied).toEqual(['0001-first', '0002-second']);
    await expectRan(['0001-first', '0002-second']);
    const rows = await recorded();
    expect(rows.map(({ checksum }) => checksum)).toEqual([
      checksumOf('// first\n'),
      checksumOf('// 0002-second\n'),
    ]);
    for (const row of rows) {
      expect(row.ran_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
  });

  it('runs nothing again, and only a migration added after the others', async () => {
    writeSource('0001-first');
    await apply([logging('0001-first')]);
    writeSource('0002-second');

    const again = await apply([logging('0001-first'), logging('0002-second')]);
    const once = await apply([logging('0001-first'), logging('0002-second')]);

    expect([again, once]).toEqual([['0002-second'], []]);
    await expectRan(['0001-first', '0002-second']);
  });

  it('refuses a migration that changed after it ran, before running any other', async () => {
    writeSource('0001-first');
    await apply([logging('0001-first')]);
    writeSource('0001-first', '// first, changed\n');
    writeSource('0002-second');

    await expect(apply([logging('0001-first'), logging('0002-second')])).rejects.toThrow(
      new DataMigrationError(
        'Data migration 0001-first has changed since it ran; write a new migration instead',
      ),
    );
    await expectRan(['0001-first']);
  });

  it('rolls back a migration that fails with its record, and runs none after it', async () => {
    writeSource('0001-first');
    writeSource('0002-second');
    writeSource('0003-third');

    await expect(
      apply([logging('0001-first'), logging('0002-second', true), logging('0003-third')]),
    ).rejects.toThrow('0002-second failed');

    await expectRan(['0001-first']);
  });

  it('applies each migration once when two runs start at the same time', async () => {
    writeSource('0001-first');
    writeSource('0002-second');
    const migrations = [logging('0001-first'), logging('0002-second')];

    const runs = await Promise.all([apply(migrations), apply(migrations)]);

    expect(runs.flat().sort()).toEqual(['0001-first', '0002-second']);
    await expectRan(['0001-first', '0002-second']);
  });

  it.each<[string, () => Migrations, string]>([
    [
      'a registered migration without its file',
      () => [logging('0001-first'), logging('0002-second')],
      'Data migration 0002-second has no file 0002-second.ts',
    ],
    [
      'a migration file missing from the registry',
      () => {
        writeSource('0002-second');
        return [logging('0001-first')];
      },
      'Data migration file 0002-second.ts is not in the registry',
    ],
    [
      'migrations registered out of order',
      () => {
        writeSource('0002-second');
        return [logging('0002-second'), logging('0001-first')];
      },
      'Data migration 0001-first is registered after 0002-second; register them in ascending order',
    ],
    [
      'a name that is not a version and words',
      () => [logging('first')],
      'Data migration name first is not well formed',
    ],
  ])('refuses %s and runs nothing', async (_case, arrange, message) => {
    writeSource('0001-first');
    writeFileSync(join(sourceDirectory, '0001-first.spec.ts'), '// a test, not a migration\n');
    const migrations = arrange();

    await expect(apply(migrations)).rejects.toThrow(new DataMigrationError(message));
    await expectRan([]);
  });

  it('refuses a migration that ran and is gone, or a new one that comes before one that ran', async () => {
    writeSource('0002-second');
    await apply([logging('0002-second')]);
    writeSource('0001-first');
    const gone = mkdtempSync(join(tmpdir(), 'thinklet-data-migrations-'));
    writeFileSync(join(gone, '0003-third.ts'), '// third\n');

    try {
      await expect(apply([logging('0001-first'), logging('0002-second')])).rejects.toThrow(
        new DataMigrationError(
          'Data migration 0001-first comes before 0002-second, which has run already',
        ),
      );
      await expect(
        applyDataMigrations({
          database,
          migrations: [logging('0003-third')],
          sourceDirectory: gone,
          context: {},
        }),
      ).rejects.toThrow(
        new DataMigrationError('Data migration 0002-second has run but is no longer registered'),
      );
    } finally {
      rmSync(gone, { recursive: true, force: true });
    }
    await expectRan(['0002-second']);
  });
});
