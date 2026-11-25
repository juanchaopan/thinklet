import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0003_names_and_member_index';

const CHECK_VIOLATION = '23514';

/** A combining accent: two bytes of UTF-8 that add no character. */
const ACUTE = String.fromCodePoint(0x301);

/** Text of exactly the given number of UTF-8 bytes in a few characters: a letter carrying accents. */
function textOfBytes(bytes: number): string {
  const text = `${bytes % 2 === 0 ? 'ab' : 'a'}${ACUTE.repeat(Math.floor((bytes - 1) / 2))}`;
  if (Buffer.byteLength(text) !== bytes) {
    throw new Error(`Made ${String(Buffer.byteLength(text))} bytes instead of ${String(bytes)}`);
  }
  return text;
}

/**
 * A value shaped like the child data cipher's ciphertext of a text of the
 * given number of bytes: key id, IV, the encrypted text and the tag, each
 * after the key id in unpadded base64url. AES-GCM keeps the text's length.
 */
function ciphertextOf(textBytes: number): string {
  return ['v1', randomBytes(12), randomBytes(textBytes), randomBytes(16)]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

// The database stops at this script, so the later ones and the data
// migrations, which would decrypt the made-up ciphertexts, do not run.
describe(`migration ${TAG}`, () => {
  let client: Client;
  let database: StartedPostgreSqlContainer;
  /** The parent, family and child written in the previous version's format. */
  const earlier = { parentId: '', familyId: '', childId: '' };
  const { rows, insertedId, failureOf, newParent, newFamily } = migrationRows(() => client);

  const renameParent = (name: string) =>
    failureOf('update parents set name = $1 where id = $2', [name, earlier.parentId]);
  const renameFamily = (name: string) =>
    failureOf('update families set name = $1 where id = $2', [name, earlier.familyId]);
  const renameChild = (nickname: string) =>
    failureOf('update children set nickname = $1 where id = $2', [nickname, earlier.childId]);

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    earlier.parentId = await newParent();
    earlier.familyId = await newFamily();
    await client.query(
      `insert into family_members (family_id, parent_id, role) values ($1, $2, 'admin')`,
      [earlier.familyId, earlier.parentId],
    );
    earlier.childId = await insertedId(
      `insert into children
         (family_id, nickname, account, account_lookup, consent_parent_id, consent_version, consented_at)
       values ($1, $2, $3, $4, $5, '2026-11-22', now())
       returning id`,
      [
        earlier.familyId,
        ciphertextOf(6),
        ciphertextOf(6),
        randomBytes(32).toString('hex'),
        earlier.parentId,
      ],
    );

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('keeps the parents, families, members and children of the previous version', async () => {
    expect(await rows('select name from parents where id = $1', [earlier.parentId])).toEqual([
      { name: '林悦' },
    ]);
    expect(await rows('select name from families where id = $1', [earlier.familyId])).toEqual([
      { name: '林悦的家' },
    ]);
    expect(
      await rows('select parent_id, role from family_members where family_id = $1', [
        earlier.familyId,
      ]),
    ).toEqual([{ parent_id: earlier.parentId, role: 'admin' }]);
    expect(await rows('select id from children where id = $1', [earlier.childId])).toEqual([
      { id: earlier.childId },
    ]);
  });

  it('indexes family_members by parent_id alone', async () => {
    expect(
      await rows(
        `select indexdef from pg_indexes
         where tablename = 'family_members' and indexname = 'family_members_parent_id_idx'`,
      ),
    ).toEqual([
      {
        indexdef:
          'CREATE INDEX family_members_parent_id_idx ON public.family_members USING btree (parent_id)',
      },
    ]);
  });

  it("finds a parent's families through the index", async () => {
    await client.query('begin');
    try {
      await client.query('set local enable_seqscan = off');
      const plan = await rows<{ 'QUERY PLAN': string }>(
        'explain select family_id from family_members where parent_id = $1',
        [randomUUID()],
      );
      expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain(
        'family_members_parent_id_idx',
      );
    } finally {
      await client.query('rollback');
    }
  });

  it("takes a parent's name of 320 bytes and refuses one of 321", async () => {
    expect(await renameParent(textOfBytes(320))).toBeUndefined();
    expect(await renameParent(textOfBytes(321))).toBe(CHECK_VIOLATION);
    expect(await renameParent('家'.repeat(107))).toBe(CHECK_VIOLATION);
  });

  it("takes a family's name of 320 bytes and refuses one of 321", async () => {
    expect(await renameFamily(textOfBytes(320))).toBeUndefined();
    expect(await renameFamily(textOfBytes(321))).toBe(CHECK_VIOLATION);
  });

  it("takes the ciphertext of a child's nickname of 160 bytes and refuses one of 161", async () => {
    expect(await renameChild(ciphertextOf(160))).toBeUndefined();
    expect(await renameChild(ciphertextOf(161))).toBe(CHECK_VIOLATION);
    expect(await renameChild(ciphertextOf(1))).toBeUndefined();
  });
});
