import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { checksumOf } from '../../src/data-migrations/apply-data-migrations.js';
import {
  ChildDataDecryptionError,
  encryptionKeyOf,
  openCiphertext,
  sealCiphertext,
  type CiphertextPlace,
} from '../../src/infrastructure/child-data/child-data-cipher.js';
import { childDevices, children } from '../../src/infrastructure/database/schema.js';
import { testChildDataCipher } from '../support/children.js';
import {
  apiDirectory,
  migrateSchema,
  runBuiltDataMigrations,
  testChildDataKey,
  type CommandRun,
} from '../support/containers.js';
import { migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0005_data_migrations';
const MIGRATION = '0001-bind-child-ciphertexts';

const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

/** The additional data of every ciphertext of the previous version: the key id alone. */
const UNBOUND = Buffer.from('v1');
const encryptionKey = encryptionKeyOf(Buffer.from(testChildDataKey, 'base64'));
const cipher = testChildDataCipher();

/** The text encrypted as the previous version wrote it, bound to no place. */
const unbound = (text: string) => sealCiphertext(encryptionKey, text, UNBOUND);

/** A value in the ciphertext layout that no key the migration has wrote. */
const undecryptable = () =>
  ['v1', ...[12, 6, 16].map((bytes) => randomBytes(bytes).toString('base64url'))].join('.');

/** What a ciphertext of the previous version reads as, or the error it fails with. */
function readUnbound(encrypted: string): string | Error {
  try {
    return openCiphertext(encryptionKey, encrypted, UNBOUND);
  } catch (error) {
    return error as Error;
  }
}

/** What a ciphertext reads as at a place, or the error it fails with there. */
function readAt(encrypted: string, place: CiphertextPlace): string | Error {
  try {
    return cipher.decrypt(encrypted, place);
  } catch (error) {
    return error as Error;
  }
}

interface ChildCiphertexts {
  id: string;
  nickname: string;
  account: string;
  updated_at: Date;
}

interface Recorded {
  name: string;
  checksum: string;
  ran_at: Date;
}

// The migration script that adds data_migrations and leaves the ids of
// children and devices to the api, then the data migration that binds every
// existing ciphertext to its row and column, run as `task migrate` runs
// them: drizzle-kit migrate, then the built dist/migrate-data.js with the
// tests' child data key. The first run meets a ciphertext it cannot read;
// the second runs once that child is gone.
describe(`migration ${TAG} and data migration ${MIGRATION}`, () => {
  let client: Client;
  let database: StartedPostgreSqlContainer;
  const { rows, insertedId, failureOf, newFamily } = migrationRows(() => client);
  /** The previous version's children and device. */
  const earlier = { xiaomi: '', doudou: '', broken: '', device: '' };
  let before: ChildCiphertexts[] = [];
  let failed: { run: CommandRun; children: ChildCiphertexts[]; recorded: Recorded[] };
  let succeeded: CommandRun;

  const childRows = () =>
    rows<ChildCiphertexts>('select id, nickname, account, updated_at from children order by id');
  const childById = async (id: string) => {
    const row = (await childRows()).find((child) => child.id === id);
    if (row === undefined) {
      throw new Error(`No child ${id}`);
    }
    return row;
  };
  const deviceName = async () => {
    const [row] = await rows<{ name: string }>('select name from child_devices where id = $1', [
      earlier.device,
    ]);
    return row?.name ?? '';
  };
  const recorded = () => rows<Recorded>('select name, checksum, ran_at from data_migrations');

  /** Adds a child of the family as the previous version did, its id from the database. */
  const addEarlierChild = (familyId: string, nickname: string, account: string) =>
    insertedId(
      `insert into children (family_id, nickname, account, account_lookup, updated_at)
       values ($1, $2, $3, $4, '2026-11-01T08:00:00Z') returning id`,
      [familyId, nickname, account, randomBytes(32).toString('hex')],
    );

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    const familyId = await newFamily();
    earlier.xiaomi = await addEarlierChild(familyId, unbound('小米'), unbound('xiaomi'));
    earlier.doudou = await addEarlierChild(familyId, unbound('豆豆'), unbound('doudou'));
    earlier.broken = await addEarlierChild(familyId, undecryptable(), unbound('ale2019'));
    earlier.device = await insertedId(
      `insert into child_devices (child_id, token_hash, name, expires_at)
       values ($1, $2, $3, now() + interval '30 days') returning id`,
      [earlier.xiaomi, randomBytes(32).toString('hex'), unbound('iPad · Safari')],
    );
    before = await childRows();

    await migrateSchema(started.url);
    const run = await runBuiltDataMigrations(started.url);
    failed = { run, children: await childRows(), recorded: await recorded() };
    await client.query('delete from children where id = $1', [earlier.broken]);
    succeeded = await runBuiltDataMigrations(started.url);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('stops at a ciphertext it cannot read, leaving every row as it was and nothing recorded', () => {
    expect(failed.run.exitCode).toBe(1);
    expect(failed.run.output).toContain('Data migrations failed');
    expect(failed.run.output).toContain('Child data cannot be decrypted');
    for (const secret of ['小米', '豆豆', 'xiaomi', 'doudou', 'iPad', testChildDataKey]) {
      expect(failed.run.output).not.toContain(secret);
    }
    expect(failed.run.output).not.toContain(database.getPassword());
    expect(failed.children).toEqual(before);
    expect(failed.recorded).toEqual([]);
  });

  it('records the migration with the checksum of its file once it runs', async () => {
    const source = readFileSync(
      join(apiDirectory, 'src', 'data-migrations', `${MIGRATION}.ts`),
      'utf8',
    );

    expect(succeeded.exitCode).toBe(0);
    expect(succeeded.output).toContain(`Data migrations run: ${MIGRATION}`);
    const [record, ...others] = await recorded();
    expect(others).toEqual([]);
    expect(record).toMatchObject({ name: MIGRATION, checksum: checksumOf(source) });
  });

  it('re-encrypts every nickname, account and device name so the api reads it at its place', async () => {
    const xiaomi = await childById(earlier.xiaomi);
    const doudou = await childById(earlier.doudou);
    const name = await deviceName();

    expect([
      readAt(xiaomi.nickname, { column: children.nickname, rowId: xiaomi.id }),
      readAt(xiaomi.account, { column: children.account, rowId: xiaomi.id }),
      readAt(doudou.nickname, { column: children.nickname, rowId: doudou.id }),
      readAt(doudou.account, { column: children.account, rowId: doudou.id }),
      readAt(name, { column: childDevices.name, rowId: earlier.device }),
    ]).toEqual(['小米', 'xiaomi', '豆豆', 'doudou', 'iPad · Safari']);
    for (const encrypted of [xiaomi.nickname, xiaomi.account, doudou.nickname, name]) {
      expect(readUnbound(encrypted)).toBeInstanceOf(ChildDataDecryptionError);
    }
  });

  it('keeps the layout and length of every ciphertext and when each child last changed', async () => {
    const layout = (encrypted: string) => encrypted.split('.').map((part) => part.length);

    for (const old of before.filter(({ id }) => id !== earlier.broken)) {
      const now = await childById(old.id);
      expect(layout(now.nickname)).toEqual(layout(old.nickname));
      expect(layout(now.account)).toEqual(layout(old.account));
      expect(now.nickname.startsWith('v1.')).toBe(true);
      expect(now.updated_at).toEqual(old.updated_at);
    }
  });

  it('leaves a ciphertext moved to another row, column or table unreadable', async () => {
    const xiaomi = await childById(earlier.xiaomi);
    const doudou = await childById(earlier.doudou);

    for (const read of [
      readAt(doudou.nickname, { column: children.nickname, rowId: xiaomi.id }),
      readAt(xiaomi.account, { column: children.nickname, rowId: xiaomi.id }),
      readAt(await deviceName(), { column: children.nickname, rowId: earlier.device }),
    ]) {
      expect(read).toBeInstanceOf(ChildDataDecryptionError);
    }
  });

  it('runs nothing and changes nothing when it runs again', async () => {
    const rowsBefore = await childRows();
    const nameBefore = await deviceName();

    const again = await runBuiltDataMigrations(database.getConnectionUri());

    expect(again.exitCode).toBe(0);
    expect(again.output).toContain('No data migrations to run');
    expect(await childRows()).toEqual(rowsBefore);
    expect(await deviceName()).toBe(nameBefore);
  });

  it('refuses to run on a record whose checksum no longer matches the file', async () => {
    const [record] = await recorded();
    await client.query('update data_migrations set checksum = $1', ['0'.repeat(64)]);

    const run = await runBuiltDataMigrations(database.getConnectionUri());
    await client.query('update data_migrations set checksum = $1', [record?.checksum]);

    expect(run.exitCode).toBe(1);
    expect(run.output).toContain(`Data migration ${MIGRATION} has changed since it ran`);
  });

  it('leaves the ids of new children and devices to the api', async () => {
    const familyId = await newFamily();

    expect(
      await failureOf(
        `insert into children (family_id, nickname, account, account_lookup) values ($1, 'a', 'b', 'c')`,
        [familyId],
      ),
    ).toBe(NOT_NULL_VIOLATION);
    expect(
      await failureOf(
        `insert into child_devices (child_id, token_hash, name, expires_at) values ($1, 'a', 'b', now())`,
        [earlier.xiaomi],
      ),
    ).toBe(NOT_NULL_VIOLATION);
  });

  it('records only well-formed names and SHA-256 checksums', async () => {
    const record = (name: string, checksum: string) =>
      failureOf(`insert into data_migrations (name, checksum, ran_at) values ($1, $2, now())`, [
        name,
        checksum,
      ]);

    expect(await record('first', 'a'.repeat(64))).toBe(CHECK_VIOLATION);
    expect(await record('0009-ninth', 'not a checksum')).toBe(CHECK_VIOLATION);
  });
});
