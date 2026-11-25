import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0001_children_and_logins';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';

/** A value shaped like the hex SHA-256 or HMAC the api stores. */
function randomHex(): string {
  return randomBytes(32).toString('hex');
}

/** The data of the previous version, written with raw SQL before the migration runs. */
interface EarlierData {
  parentId: string;
  familyId: string;
  code: string;
  requestId: string;
}

describe(`migration ${TAG}`, () => {
  let database: StartedPostgreSqlContainer;
  let client: Client;
  let earlier: EarlierData;
  const { rows, insertedId, newParent, newFamily } = migrationRows(() => client);

  async function exists(relation: string): Promise<boolean> {
    const [row] = await rows<{ name: string | null }>('select to_regclass($1)::text as name', [
      `public.${relation}`,
    ]);
    return typeof row?.name === 'string';
  }

  function insertChild(familyId: string, parentId: string, accountLookup = randomHex()) {
    return client.query<{ id: string }>(
      `insert into children
         (family_id, nickname, account, account_lookup, consent_parent_id, consent_version, consented_at)
       values ($1, 'nickname-ciphertext', 'account-ciphertext', $3, $2, '2026-11-22', now())
       returning id`,
      [familyId, parentId, accountLookup],
    );
  }

  async function newChild(): Promise<string> {
    const { rows: inserted } = await insertChild(earlier.familyId, earlier.parentId);
    const [row] = inserted;
    if (!row) {
      throw new Error('The child was not inserted');
    }
    return row.id;
  }

  function insertLink(childId: string, tokenHash = randomHex()) {
    return client.query(
      `insert into child_login_links (child_id, token_hash, created_by, expires_at)
       values ($1, $2, $3, now() + interval '10 minutes')`,
      [childId, tokenHash, earlier.parentId],
    );
  }

  function insertDevice(childId: string, tokenHash = randomHex()) {
    return client.query(
      `insert into child_devices (child_id, token_hash, name, expires_at)
       values ($1, $2, 'device-name-ciphertext', now() + interval '30 days')`,
      [childId, tokenHash],
    );
  }

  async function countOf(table: string, childId: string): Promise<number> {
    const [row] = await rows<{ count: string }>(
      `select count(*) as count from ${table} where child_id = $1`,
      [childId],
    );
    return Number(row?.count);
  }

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);
    expect(await exists('children')).toBe(false);

    // A family with its admin and a pending join request, as the previous
    // version keeps them.
    const parentId = await newParent();
    const applicantId = await newParent();
    const code = 'K7Q4MZ';
    const familyId = await newFamily(code);
    await client.query(
      `insert into family_members (family_id, parent_id, role) values ($1, $2, 'admin')`,
      [familyId, parentId],
    );
    const requestId = await insertedId(
      `insert into join_requests (family_id, parent_id, code, status)
       values ($1, $2, $3, 'pending') returning id`,
      [familyId, applicantId, code],
    );
    earlier = { parentId, familyId, code, requestId };

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('keeps the families, members and join requests of the previous version', async () => {
    expect(
      await rows('select name, timezone, code from families where id = $1', [earlier.familyId]),
    ).toEqual([{ name: '林悦的家', timezone: 'Asia/Shanghai', code: earlier.code }]);
    expect(
      await rows('select parent_id, role from family_members where family_id = $1', [
        earlier.familyId,
      ]),
    ).toEqual([{ parent_id: earlier.parentId, role: 'admin' }]);
    expect(
      await rows('select family_id, code, status from join_requests where id = $1', [
        earlier.requestId,
      ]),
    ).toEqual([{ family_id: earlier.familyId, code: earlier.code, status: 'pending' }]);
  });

  it('creates the three tables and their indexes', async () => {
    for (const relation of [
      'children',
      'child_login_links',
      'child_devices',
      'child_login_links_child_id_idx',
      'child_devices_token_hash_idx',
    ]) {
      expect(await exists(relation), relation).toBe(true);
    }
  });

  it('adds a child to a family of the previous version without a password', async () => {
    const childId = await newChild();

    const [row] = await rows<Record<string, unknown>>(
      `select password_hash, sessions_valid_after, consent_parent_id, consent_version,
              consented_at, created_at, updated_at
       from children where id = $1`,
      [childId],
    );
    expect(row).toMatchObject({
      password_hash: null,
      consent_parent_id: earlier.parentId,
      consent_version: '2026-11-22',
    });
    for (const column of ['sessions_valid_after', 'consented_at', 'created_at', 'updated_at']) {
      expect(row?.[column], column).toBeInstanceOf(Date);
    }
  });

  it('keeps an account unique within a family but not across families', async () => {
    const lookup = randomHex();
    await insertChild(earlier.familyId, earlier.parentId, lookup);

    await expect(insertChild(earlier.familyId, earlier.parentId, lookup)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'children_family_account_unique',
    });
    await expect(insertChild(await newFamily(), earlier.parentId, lookup)).resolves.toBeDefined();
  });

  it('rejects children of a family or a consenting parent that does not exist', async () => {
    await expect(insertChild(randomUUID(), earlier.parentId)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(insertChild(earlier.familyId, randomUUID())).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it('requires the ciphertexts, the lookup value and the consent of a child', async () => {
    const childId = await newChild();

    for (const column of ['nickname', 'account', 'account_lookup', 'consent_version']) {
      await expect(
        client.query(`update children set ${column} = null where id = $1`, [childId]),
        column,
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
    }
  });

  it('keeps login link token hashes unique across all children', async () => {
    const tokenHash = randomHex();
    await insertLink(await newChild(), tokenHash);

    await expect(insertLink(await newChild(), tokenHash)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'child_login_links_token_hash_unique',
    });
  });

  it('rejects login links of a child that does not exist', async () => {
    await expect(insertLink(randomUUID())).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it('remembers a browser once per child and shares its token between children', async () => {
    const tokenHash = randomHex();
    const childId = await newChild();
    await insertDevice(childId, tokenHash);

    await expect(insertDevice(childId, tokenHash)).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'child_devices_child_token_unique',
    });
    await expect(insertDevice(await newChild(), tokenHash)).resolves.toBeDefined();
  });

  it('rejects devices of a child that does not exist', async () => {
    await expect(insertDevice(randomUUID())).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it("deletes a child's login links and devices with the child and leaves other children's", async () => {
    const childId = await newChild();
    const otherId = await newChild();
    const sharedToken = randomHex();
    for (const id of [childId, otherId]) {
      await insertLink(id);
      await insertDevice(id, sharedToken);
    }

    await client.query('delete from children where id = $1', [childId]);

    expect(await countOf('child_login_links', childId)).toBe(0);
    expect(await countOf('child_devices', childId)).toBe(0);
    expect(await countOf('child_login_links', otherId)).toBe(1);
    expect(await countOf('child_devices', otherId)).toBe(1);
  });
});
