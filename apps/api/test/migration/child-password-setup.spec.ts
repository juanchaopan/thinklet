import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0007_child_password_setup';

/** A stand-in for the argon2id hash of a password the child has set. */
const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

// Children set their first password themselves (#14, 25): the migration
// adds until when a child without a password may set one with the family
// code and the account. Children added before it keep what they had: a
// child with a password keeps it, and a child without one has no such
// time, so sets it with a login QR code or after a reset (data.md,
// children). The database stops at this script.
describe(`migration ${TAG}`, () => {
  let client: Client;
  let database: StartedPostgreSqlContainer;
  /** The children written in the previous version's format: one with a password, one without. */
  const earlier = { withPassword: '', withoutPassword: '' };
  const { rows, insertedId, failureOf, newFamily } = migrationRows(() => client);

  /** Adds a child to the family in the previous version's format, with the password hash given. */
  const insertChild = (familyId: string, passwordHash: string | null) =>
    insertedId(
      `insert into children (id, family_id, nickname, account, account_lookup, password_hash)
       values ($1, $2, 'nickname-ciphertext', 'account-ciphertext', $3, $4)
       returning id`,
      [randomUUID(), familyId, randomBytes(32).toString('hex'), passwordHash],
    );

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    const familyId = await newFamily();
    earlier.withPassword = await insertChild(familyId, PASSWORD_HASH);
    earlier.withoutPassword = await insertChild(familyId, null);

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it('adds password_setup_until as a nullable time with its time zone and no default', async () => {
    expect(
      await rows(
        `select data_type, is_nullable, column_default from information_schema.columns
         where table_name = 'children' and column_name = 'password_setup_until'`,
      ),
    ).toEqual([
      { data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('keeps the password of a child who has one, with no time to set another', async () => {
    expect(
      await rows('select password_hash, password_setup_until from children where id = $1', [
        earlier.withPassword,
      ]),
    ).toEqual([{ password_hash: PASSWORD_HASH, password_setup_until: null }]);
  });

  it('gives a child without a password no time to set one with the account', async () => {
    expect(
      await rows('select password_hash, password_setup_until from children where id = $1', [
        earlier.withoutPassword,
      ]),
    ).toEqual([{ password_hash: null, password_setup_until: null }]);
  });

  it('takes a time for a child, as adding a child or resetting the password writes it', async () => {
    expect(
      await failureOf(
        `update children set password_setup_until = now() + interval '48 hours' where id = $1`,
        [earlier.withoutPassword],
      ),
    ).toBeUndefined();
    const [row] = await rows<{ open: boolean }>(
      'select password_setup_until > now() as open from children where id = $1',
      [earlier.withoutPassword],
    );
    expect(row).toEqual({ open: true });
  });
});
