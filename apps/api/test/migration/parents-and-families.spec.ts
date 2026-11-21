import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { migrate, startDatabase } from '../support/containers.js';
import { migrateBefore, readJournal } from '../support/migrations.js';

const TAG = '0000_parents_and_families';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

/** A random six-character code; the database takes any six characters, the api keeps to the alphabet. */
function randomCode(): string {
  return randomUUID().slice(0, 6).toUpperCase();
}

describe(`migration ${TAG}`, () => {
  let database: StartedPostgreSqlContainer;
  let client: Client;

  /** The single row a query returns. */
  async function one<T extends object>(text: string, values: unknown[] = []): Promise<T> {
    const { rows } = await client.query<T>(text, values);
    const [row] = rows;
    if (rows.length !== 1 || !row) {
      throw new Error(`Expected one row, got ${rows.length}`);
    }
    return row;
  }

  async function tableExists(name: string): Promise<boolean> {
    const row = await one<{ name: string | null }>('select to_regclass($1)::text as name', [
      `public.${name}`,
    ]);
    return row.name !== null;
  }

  async function count(text: string, values: unknown[]): Promise<number> {
    return Number((await one<{ count: string }>(text, values)).count);
  }

  async function newParent(): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into parents (oidc_issuer, oidc_subject, name, consent_version, consented_at)
       values ('https://issuer.example', $1, '林悦', '2026-11-21', now()) returning id`,
      [randomUUID()],
    );
    return row.id;
  }

  async function newFamily(): Promise<string> {
    const row = await one<{ id: string }>(
      `insert into families (name, timezone, code)
       values ('林悦的家', 'Asia/Shanghai', $1) returning id`,
      [randomCode()],
    );
    return row.id;
  }

  function addMember(familyId: string, parentId: string, role: string) {
    return client.query(
      'insert into family_members (family_id, parent_id, role) values ($1, $2, $3)',
      [familyId, parentId, role],
    );
  }

  function addRequest(familyId: string, parentId: string, status: string) {
    return client.query(
      `insert into join_requests (family_id, parent_id, code, status)
       select id, $2, code, $3 from families where id = $1`,
      [familyId, parentId, status],
    );
  }

  beforeAll(async () => {
    database = await startDatabase();
    const url = database.getConnectionUri();
    // This is the first migration: the previous version has no tables of
    // the app, so there is no data in an older format to carry over.
    await migrateBefore(url, TAG);
    client = new Client({ connectionString: url });
    await client.connect();
    expect(await tableExists('parents')).toBe(false);

    await migrate(url);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('applies on the database at the previous version and records every migration', async () => {
    for (const table of ['parents', 'families', 'family_members', 'join_requests']) {
      expect(await tableExists(table), table).toBe(true);
    }
    expect(await count('select count(*) as count from drizzle.__drizzle_migrations', [])).toBe(
      readJournal().entries.length,
    );
  });

  it('generates ids and creation times in the database', async () => {
    const parentId = await newParent();

    const row = await one<{ created_at: unknown; updated_at: unknown }>(
      'select created_at, updated_at from parents where id = $1',
      [parentId],
    );
    expect(parentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  it('allows one parent per Authing issuer and subject', async () => {
    const insert = `insert into parents (oidc_issuer, oidc_subject, name, consent_version, consented_at)
                    values ($1, $2, '林悦', '2026-11-21', now())`;
    const subject = randomUUID();
    await client.query(insert, ['https://issuer.example', subject]);

    await expect(client.query(insert, ['https://issuer.example', subject])).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'parents_oidc_identity_unique',
    });
    await expect(client.query(insert, ['https://other.example', subject])).resolves.toBeDefined();
  });

  it('keeps family codes unique across the platform', async () => {
    const code = randomCode();
    const insert = `insert into families (name, timezone, code) values ('外婆家', 'Asia/Shanghai', $1)`;
    await client.query(insert, [code]);

    await expect(client.query(insert, [code])).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'families_code_unique',
    });
  });

  it('rejects a second admin in a family but allows members and admins of other families', async () => {
    const familyId = await newFamily();
    const otherFamilyId = await newFamily();
    const first = await newParent();
    const second = await newParent();
    await addMember(familyId, first, 'admin');

    await expect(addMember(familyId, second, 'admin')).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'family_members_one_admin_per_family',
    });
    await expect(addMember(familyId, second, 'member')).resolves.toBeDefined();
    await expect(addMember(familyId, await newParent(), 'member')).resolves.toBeDefined();
    await expect(addMember(otherFamilyId, second, 'admin')).resolves.toBeDefined();
  });

  it('lets the admin role move to another member in one transaction', async () => {
    const familyId = await newFamily();
    const admin = await newParent();
    const member = await newParent();
    await addMember(familyId, admin, 'admin');
    await addMember(familyId, member, 'member');
    const setRole = `update family_members set role = $3 where family_id = $1 and parent_id = $2`;

    await client.query('begin');
    await client.query(setRole, [familyId, admin, 'member']);
    await client.query(setRole, [familyId, member, 'admin']);
    await client.query('commit');

    const row = await one<{ parent_id: string }>(
      `select parent_id from family_members where family_id = $1 and role = 'admin'`,
      [familyId],
    );
    expect(row.parent_id).toBe(member);
  });

  it('allows a parent in a family only once', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addMember(familyId, parentId, 'member');

    await expect(addMember(familyId, parentId, 'member')).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'family_members_family_id_parent_id_pk',
    });
  });

  it('accepts only the admin and member roles', async () => {
    await expect(addMember(await newFamily(), await newParent(), 'owner')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'family_members_role_check',
    });
  });

  it('rejects members of families or parents that do not exist', async () => {
    await expect(addMember(randomUUID(), await newParent(), 'member')).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
    await expect(addMember(await newFamily(), randomUUID(), 'member')).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it('rejects a second pending request of a parent to a family', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addRequest(familyId, parentId, 'pending');

    await expect(addRequest(familyId, parentId, 'pending')).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'join_requests_one_pending_per_parent',
    });
  });

  it('keeps any number of closed requests next to a pending one', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addRequest(familyId, parentId, 'pending');

    for (const status of ['approved', 'rejected', 'withdrawn', 'expired', 'rejected', 'expired']) {
      await expect(addRequest(familyId, parentId, status), status).resolves.toBeDefined();
    }
    expect(
      await count(
        'select count(*) as count from join_requests where family_id = $1 and parent_id = $2',
        [familyId, parentId],
      ),
    ).toBe(7);
  });

  it('allows a new pending request once the earlier one has closed', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addRequest(familyId, parentId, 'pending');
    await client.query(
      `update join_requests set status = 'expired', closed_at = now()
       where family_id = $1 and parent_id = $2`,
      [familyId, parentId],
    );

    await expect(addRequest(familyId, parentId, 'pending')).resolves.toBeDefined();
  });

  it('allows pending requests of other parents and to other families', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addRequest(familyId, parentId, 'pending');

    await expect(addRequest(familyId, await newParent(), 'pending')).resolves.toBeDefined();
    await expect(addRequest(await newFamily(), parentId, 'pending')).resolves.toBeDefined();
  });

  it('accepts only the five request statuses', async () => {
    await expect(addRequest(await newFamily(), await newParent(), 'done')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'join_requests_status_check',
    });
  });

  it('rejects a request closed by a parent that does not exist', async () => {
    const familyId = await newFamily();
    const parentId = await newParent();
    await addRequest(familyId, parentId, 'pending');

    await expect(
      client.query(
        `update join_requests set status = 'approved', closed_at = now(), closed_by = $3
         where family_id = $1 and parent_id = $2`,
        [familyId, parentId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});
