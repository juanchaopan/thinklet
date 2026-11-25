import { randomBytes, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { childSchema, type Child } from '@thinklet/contracts';
import { ChildDataCipher } from '../../src/infrastructure/child-data/child-data-cipher.js';
import type { Environment } from '../../src/infrastructure/config/environment.js';
import { childDevices, children } from '../../src/infrastructure/database/schema.js';
import { testChildDataKey } from './containers.js';
import { query } from './database.js';
import { as, type Parent } from './families.js';
import type { Target } from './login.js';

// Helpers for tests of the children routes: children added through the api,
// login links and remembered devices set up directly in the database, and
// what the database holds about them.

/** The api's child data cipher with the key of every api the tests start. */
export function testChildDataCipher(): ChildDataCipher {
  const key = Buffer.from(testChildDataKey, 'base64');
  return new ChildDataCipher({ get: () => key } as unknown as ConfigService<Environment, true>);
}

/** The children routes of the family. */
export const childrenPath = (familyId: string) => `/api/families/${familyId}/children`;

/** The route of one child of the family. */
export const childPath = (familyId: string, childId: string) =>
  `${childrenPath(familyId)}/${childId}`;

/** An account no other test uses, made of lower-case letters and digits. */
export function newAccount(): string {
  return `kid${randomBytes(6).toString('hex')}`;
}

/** Adds a child to the family as the parent through the api and returns it. */
export async function addChild(
  target: Target,
  parent: Parent,
  familyId: string,
  child: { nickname?: string; account?: string } = {},
): Promise<Child> {
  const response = await as(target, parent).post(childrenPath(familyId), {
    nickname: child.nickname ?? '小米',
    account: child.account ?? newAccount(),
    consent: true,
  });
  if (response.status !== 201) {
    throw new Error(`The child was not added: ${response.status}`);
  }
  return childSchema.parse(response.body);
}

/** A row of the children table. */
export interface ChildRow {
  id: string;
  family_id: string;
  nickname: string;
  account: string;
  account_lookup: string;
  password_hash: string | null;
  sessions_valid_after: Date;
  created_at: Date;
  updated_at: Date;
}

/** The child's row, or undefined when there is none. */
export async function childRow(
  databaseUrl: string,
  childId: string,
): Promise<ChildRow | undefined> {
  const [row] = await query<ChildRow>(databaseUrl, 'select * from children where id = $1', [
    childId,
  ]);
  return row;
}

/** The nickname and the account of a child's row, decrypted where the row holds them. */
export function decryptedChild(row: Pick<ChildRow, 'id' | 'nickname' | 'account'>): {
  nickname: string;
  account: string;
} {
  const cipher = testChildDataCipher();
  return {
    nickname: cipher.decrypt(row.nickname, { column: children.nickname, rowId: row.id }),
    account: cipher.decrypt(row.account, { column: children.account, rowId: row.id }),
  };
}

/** Gives the child a password hash directly in the database, as setting a password does. */
export async function setPasswordHash(databaseUrl: string, childId: string): Promise<void> {
  await query(databaseUrl, 'update children set password_hash = $2 where id = $1', [
    childId,
    '$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$aGFzaA',
  ]);
}

/** A row of the child_login_links table. */
export interface LoginLinkRow {
  id: string;
  child_id: string;
  token_hash: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
}

/** The child's login links as the database holds them, oldest first. */
export async function loginLinkRows(databaseUrl: string, childId: string): Promise<LoginLinkRow[]> {
  return query<LoginLinkRow>(
    databaseUrl,
    'select * from child_login_links where child_id = $1 order by created_at, id',
    [childId],
  );
}

/**
 * Records a login link of the child directly in the database: by default
 * one made a minute ago that expires in nine, with the given SQL
 * expressions for its times.
 */
export async function insertLoginLink(
  databaseUrl: string,
  child: { id: string; createdBy: string },
  times: { expiresAt?: string; usedAt?: string; revokedAt?: string } = {},
): Promise<string> {
  const [row] = await query<{ id: string }>(
    databaseUrl,
    `insert into child_login_links (child_id, token_hash, created_by, created_at, expires_at, used_at, revoked_at)
     values ($1, $2, $3, now() - interval '1 minute', ${times.expiresAt ?? "now() + interval '9 minutes'"},
             ${times.usedAt ?? 'null'}, ${times.revokedAt ?? 'null'})
     returning id`,
    [child.id, randomBytes(32).toString('hex'), child.createdBy],
  );
  if (row === undefined) {
    throw new Error('No login link recorded');
  }
  return row.id;
}

/** A row of the child_devices table. */
export interface DeviceRow {
  id: string;
  child_id: string;
  token_hash: string;
  name: string;
  remembered_at: Date;
  last_used_at: Date;
  expires_at: Date;
}

/** The child's remembered devices as the database holds them. */
export async function deviceRows(databaseUrl: string, childId: string): Promise<DeviceRow[]> {
  return query<DeviceRow>(
    databaseUrl,
    'select * from child_devices where child_id = $1 order by last_used_at desc, id',
    [childId],
  );
}

/** The name of a device's row, decrypted where the row holds it. */
export function decryptedDeviceName(row: Pick<DeviceRow, 'id' | 'name'>): string {
  return testChildDataCipher().decrypt(row.name, { column: childDevices.name, rowId: row.id });
}

/**
 * Remembers the child on a browser directly in the database, with an id of
 * its own and the name encrypted for it as the api stores it, and the last
 * login the given time.
 */
export async function insertDevice(
  databaseUrl: string,
  childId: string,
  device: { name: string; rememberedAt: Date; lastUsedAt: Date },
): Promise<string> {
  const id = randomUUID();
  await query(
    databaseUrl,
    `insert into child_devices (id, child_id, token_hash, name, remembered_at, last_used_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $6::timestamptz + interval '30 days')`,
    [
      id,
      childId,
      randomBytes(32).toString('hex'),
      testChildDataCipher().encrypt(device.name, { column: childDevices.name, rowId: id }),
      device.rememberedAt,
      device.lastUsedAt,
    ],
  );
  return id;
}
