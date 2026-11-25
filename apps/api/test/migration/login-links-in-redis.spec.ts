import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0006_login_links_in_redis';

/** A value shaped like the hex SHA-256 the api stores. */
function randomHex(): string {
  return randomBytes(32).toString('hex');
}

// The children's login links move to Redis (#14, 24): the migration drops
// their table with its foreign keys and index, the links in it are not
// moved, and the children and parents they named stay, a parent who only
// ever made a link now free to be deleted. The database stops at this
// script.
describe(`migration ${TAG}`, () => {
  let client: Client;
  let database: StartedPostgreSqlContainer;
  /** The rows written in the previous version's format. */
  const earlier = { adminId: '', makerId: '', familyId: '', childId: '' };
  const { rows, insertedId, failureOf, relationExists, newParent, newFamily } = migrationRows(
    () => client,
  );

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    earlier.adminId = await newParent();
    earlier.makerId = await newParent();
    earlier.familyId = await newFamily();
    await client.query(
      `insert into family_members (family_id, parent_id, role) values ($1, $2, 'admin')`,
      [earlier.familyId, earlier.adminId],
    );
    earlier.childId = await insertedId(
      `insert into children (id, family_id, nickname, account, account_lookup)
       values ($1, $2, 'nickname-ciphertext', 'account-ciphertext', $3)
       returning id`,
      [randomUUID(), earlier.familyId, randomHex()],
    );
    for (const [createdBy, times] of [
      [earlier.adminId, "now() + interval '9 minutes', null"],
      [earlier.makerId, "now() + interval '5 minutes', now()"],
    ] as const) {
      await client.query(
        `insert into child_login_links (child_id, token_hash, created_by, expires_at, used_at)
         values ($1, $2, $3, ${times})`,
        [earlier.childId, randomHex(), createdBy],
      );
    }

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('drops the login links table and its index, with the links it held', async () => {
    expect(await relationExists('child_login_links')).toBe(false);
    expect(await relationExists('child_login_links_child_id_idx')).toBe(false);
  });

  it('leaves no constraint of the table behind', async () => {
    expect(
      await rows("select conname from pg_constraint where conname like 'child_login_links%'"),
    ).toEqual([]);
  });

  it('keeps the parents, the family, its member and the child', async () => {
    expect(
      await rows<{ id: string }>('select id from parents where id = any($1) order by id', [
        [earlier.adminId, earlier.makerId],
      ]),
    ).toHaveLength(2);
    expect(
      await rows('select parent_id, role from family_members where family_id = $1', [
        earlier.familyId,
      ]),
    ).toEqual([{ parent_id: earlier.adminId, role: 'admin' }]);
    expect(await rows('select id from children where id = $1', [earlier.childId])).toEqual([
      { id: earlier.childId },
    ]);
  });

  it('lets a parent who only made a login link be deleted, as nothing references them', async () => {
    expect(await failureOf('delete from parents where id = $1', [earlier.makerId])).toBeUndefined();
    expect(await rows('select id from parents where id = $1', [earlier.makerId])).toEqual([]);
  });

  it('lets the child be deleted with its devices, its links no longer in the database', async () => {
    await client.query(
      `insert into child_devices (id, child_id, token_hash, name, expires_at)
       values ($1, $2, $3, 'device-name-ciphertext', now() + interval '30 days')`,
      [randomUUID(), earlier.childId, randomHex()],
    );

    expect(
      await failureOf('delete from children where id = $1', [earlier.childId]),
    ).toBeUndefined();
    expect(
      await rows('select id from child_devices where child_id = $1', [earlier.childId]),
    ).toEqual([]);
  });
});
