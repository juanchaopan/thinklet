import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { ChildDataCipher } from '../../infrastructure/child-data/child-data-cipher.js';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { LoginLinks, type ActiveLoginLink } from './login-links.js';

const { children, childDevices, families } = schema;

/** A child as a login checks it: found by the family and the account, or by its id. */
export interface LoginCandidate {
  id: string;
  familyId: string;
  nickname: string;
  /** The argon2id hash of the child's password, or null when the child has none yet. */
  passwordHash: string | null;
  /**
   * Until when the child, while without a password, may set one by logging
   * in with the family code and the account; null when there is no such time.
   */
  passwordSetupUntil: Date | null;
}

/**
 * Whether the child may set a first password with the family code and the
 * account at the database's time `at`: the child has no password, and the
 * time a parent left for it has not run out.
 */
export function canSetPasswordWithAccount(child: LoginCandidate, at: Date): boolean {
  return (
    child.passwordHash === null &&
    child.passwordSetupUntil !== null &&
    child.passwordSetupUntil.getTime() > at.getTime()
  );
}

/** A child the browser remembers, in plain text, with its family to fetch the code of. */
export interface RememberedRecord {
  childId: string;
  familyId: string;
  nickname: string;
  account: string;
}

/** What a signed-in child sees of itself, in plain text, with its family. */
export interface ChildProfile {
  familyId: string;
  familyName: string;
  nickname: string;
  account: string;
}

/** The browser to remember a child on, and when. */
export interface RememberedDevice {
  childId: string;
  tokenHash: string;
  /** The device name in plain text; it is stored encrypted. */
  name: string;
  now: Date;
  expiresAt: Date;
}

/** The browser whose device token a login replaces, the family whose devices go with it, and when. */
export interface DeviceTokenChange {
  familyId: string;
  /** The hash of the token the browser had. */
  fromTokenHash: string;
  /** The hash of the token the login gives it. */
  toTokenHash: string;
  now: Date;
}

/** What the check of a signed-in child reads of the child's row, with the database's time of the read. */
export interface SessionCheck {
  /** The time before which the child's logins are refused. */
  sessionsValidAfter: Date;
  /** The database's clock as the row was read. */
  checkedAt: Date;
}

const candidateColumns = {
  id: children.id,
  familyId: children.familyId,
  nickname: children.nickname,
  passwordHash: children.passwordHash,
  passwordSetupUntil: children.passwordSetupUntil,
};

/**
 * The database's clock as the statement runs, in milliseconds since the
 * epoch, as a number the driver hands over as it is. `clock_timestamp()`
 * moves on within a transaction, where `now()` would stay at the
 * transaction's start, before any lock the transaction waited for. A new
 * fragment every time, as a mapping set on one would be set on all.
 */
const databaseClockMs = () => sql<number>`(extract(epoch from clock_timestamp()) * 1000)::float8`;

/**
 * The queries of a child's login, on the pool or inside one transaction:
 * finding the child by account or by id, the child's password and the
 * check of a signed-in child, what a signed-in child sees of itself, and
 * the browsers the child is remembered on. The nickname, the account and
 * the device names are encrypted on the way in and decrypted on the way
 * out, each bound to its column and its row's id. Every time a login
 * compares or writes is the database's, so api instances whose clocks
 * differ agree on it.
 */
export class ChildLoginStore {
  constructor(
    protected readonly executor: Executor,
    protected readonly cipher: ChildDataCipher,
  ) {}

  /** The family's child with the account, found by its lookup value, or undefined. */
  async findLoginCandidate(familyId: string, account: string): Promise<LoginCandidate | undefined> {
    const rows = await this.executor
      .select(candidateColumns)
      .from(children)
      .where(
        and(
          eq(children.familyId, familyId),
          eq(children.accountLookup, this.cipher.lookup(familyId, account)),
        ),
      );
    return this.readCandidate(rows.at(0));
  }

  /** The child with the id, unlocked, or undefined when the child is gone. */
  async findCandidate(childId: string): Promise<LoginCandidate | undefined> {
    const rows = await this.executor
      .select(candidateColumns)
      .from(children)
      .where(eq(children.id, childId));
    return this.readCandidate(rows.at(0));
  }

  /**
   * The child with its password as it is now, its row locked until the
   * transaction ends, or undefined when the child is gone. A password reset
   * and the making of a login link lock the same row, so each runs wholly
   * before or after the transaction.
   */
  async lockChild(childId: string): Promise<LoginCandidate | undefined> {
    const rows = await this.executor
      .select(candidateColumns)
      .from(children)
      .where(eq(children.id, childId))
      .for('update');
    return this.readCandidate(rows.at(0));
  }

  /** The database's clock now, read in a statement of its own, so after any lock taken before it. */
  async databaseNow(): Promise<Date> {
    const { rows } = await this.executor.execute<{ ms: number }>(
      sql`select ${databaseClockMs()} as ms`,
    );
    const ms = rows.at(0)?.ms;
    if (ms === undefined) {
      throw new Error("The database did not answer its clock's time");
    }
    return new Date(ms);
  }

  /**
   * The time before which the child's logins are refused, read with the
   * database's clock, or undefined when the child is gone.
   */
  async sessionCheck(childId: string): Promise<SessionCheck | undefined> {
    const rows = await this.executor
      .select({
        sessionsValidAfter: children.sessionsValidAfter,
        checkedAtMs: databaseClockMs().mapWith(Number),
      })
      .from(children)
      .where(eq(children.id, childId));
    const row = rows.at(0);
    return row === undefined
      ? undefined
      : { sessionsValidAfter: row.sessionsValidAfter, checkedAt: new Date(row.checkedAtMs) };
  }

  /**
   * The child's nickname and account with the family it belongs to and that
   * family's name, or undefined when the child is gone.
   */
  async findProfile(childId: string): Promise<ChildProfile | undefined> {
    const rows = await this.executor
      .select({
        familyId: children.familyId,
        familyName: families.name,
        nickname: children.nickname,
        account: children.account,
      })
      .from(children)
      .innerJoin(families, eq(families.id, children.familyId))
      .where(eq(children.id, childId));
    const row = rows.at(0);
    return row === undefined
      ? undefined
      : {
          ...row,
          nickname: this.nicknameOf(childId, row.nickname),
          account: this.cipher.decrypt(row.account, { column: children.account, rowId: childId }),
        };
  }

  /** Stores the child's first password; the time for setting one with the account ends with it. */
  async setPassword(childId: string, passwordHash: string): Promise<void> {
    await this.executor
      .update(children)
      .set({ passwordHash, passwordSetupUntil: null })
      .where(eq(children.id, childId));
  }

  /** Deletes the child's devices that have expired by `now`; other children's are left to their own logins. */
  async deleteExpiredDevices(childId: string, now: Date): Promise<void> {
    await this.executor
      .delete(childDevices)
      .where(and(eq(childDevices.childId, childId), lte(childDevices.expiresAt, now)));
  }

  /**
   * Moves the browser's devices of the family's children that are still
   * valid at `now` from the browser's old token to its new one, each keeping
   * its row: its id, its name and its times. The rows of other families'
   * children, and expired ones, stay under the old token. The new token is
   * one just made, which no row has yet, so no move meets a row it would
   * duplicate.
   */
  async moveFamilyDevices(change: DeviceTokenChange): Promise<void> {
    const familyChildren = this.executor
      .select({ id: children.id })
      .from(children)
      .where(eq(children.familyId, change.familyId));
    await this.executor
      .update(childDevices)
      .set({ tokenHash: change.toTokenHash })
      .where(
        and(
          eq(childDevices.tokenHash, change.fromTokenHash),
          gt(childDevices.expiresAt, change.now),
          inArray(childDevices.childId, familyChildren),
        ),
      );
  }

  /**
   * Remembers the child on the browser with the token's hash, as a new
   * device with an id of its own and its name encrypted for that id, or
   * renews the browser's row: the last login is now and it lasts until
   * `expiresAt`, keeping its id, when it was first remembered and its name.
   * A login deletes the child's expired devices before it remembers the
   * browser, under the child's lock, so the row renewed is one still valid.
   */
  async rememberDevice(device: RememberedDevice): Promise<void> {
    const id = randomUUID();
    await this.executor
      .insert(childDevices)
      .values({
        id,
        childId: device.childId,
        tokenHash: device.tokenHash,
        name: this.cipher.encrypt(device.name, { column: childDevices.name, rowId: id }),
        rememberedAt: device.now,
        lastUsedAt: device.now,
        expiresAt: device.expiresAt,
      })
      .onConflictDoUpdate({
        target: [childDevices.childId, childDevices.tokenHash],
        set: {
          lastUsedAt: sql`excluded.last_used_at`,
          expiresAt: sql`excluded.expires_at`,
        },
      });
  }

  /**
   * Renews the browser's row of the child when it is still valid at `now`:
   * the last login is now and it lasts until `expiresAt`. Returns whether
   * there was such a row.
   */
  async renewDevice(
    childId: string,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const rows = await this.executor
      .update(childDevices)
      .set({ lastUsedAt: now, expiresAt })
      .where(
        and(
          eq(childDevices.childId, childId),
          eq(childDevices.tokenHash, tokenHash),
          gt(childDevices.expiresAt, now),
        ),
      )
      .returning({ id: childDevices.id });
    return rows.length > 0;
  }

  /** Forgets the child on the browser with the token's hash; a browser that never remembered it is no change. */
  async forgetDevice(childId: string, tokenHash: string): Promise<void> {
    await this.executor
      .delete(childDevices)
      .where(and(eq(childDevices.childId, childId), eq(childDevices.tokenHash, tokenHash)));
  }

  /**
   * The children the browser with the token's hash remembers by the
   * database's clock, in the order remembered.
   */
  async listRemembered(tokenHash: string): Promise<RememberedRecord[]> {
    const rows = await this.executor
      .select({
        childId: children.id,
        familyId: children.familyId,
        nickname: children.nickname,
        account: children.account,
      })
      .from(childDevices)
      .innerJoin(children, eq(children.id, childDevices.childId))
      .where(and(eq(childDevices.tokenHash, tokenHash), gt(childDevices.expiresAt, sql`now()`)))
      .orderBy(asc(childDevices.rememberedAt), asc(childDevices.id));
    return rows.map((row) => ({
      ...row,
      nickname: this.nicknameOf(row.childId, row.nickname),
      account: this.cipher.decrypt(row.account, { column: children.account, rowId: row.childId }),
    }));
  }

  /** The nickname of the child with the id, from its ciphertext. */
  private nicknameOf(childId: string, encrypted: string): string {
    return this.cipher.decrypt(encrypted, { column: children.nickname, rowId: childId });
  }

  private readCandidate(row: LoginCandidate | undefined): LoginCandidate | undefined {
    return row === undefined
      ? undefined
      : { ...row, nickname: this.nicknameOf(row.id, row.nickname) };
  }
}

/**
 * The data of children's logins. Its own queries run on the pool;
 * `transaction` runs a unit of work with the same queries inside one
 * transaction, and hands the work the transaction too, for the audit event
 * of a change the login makes. The login links a login reads and uses are
 * in Redis, outside any transaction, through LoginLinks.
 */
@Injectable()
export class ChildLoginRepository extends ChildLoginStore {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    cipher: ChildDataCipher,
    private readonly links: LoginLinks,
  ) {
    super(database, cipher);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: ChildLoginStore, transaction: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new ChildLoginStore(transaction, this.cipher), transaction),
    );
  }

  /** The login link the token's hash opens while it can be used, or undefined. */
  findLink(tokenHash: string): Promise<ActiveLoginLink | undefined> {
    return this.links.find(tokenHash);
  }

  /** Uses the login link; false when it was used, revoked or expired before. */
  takeLink(link: ActiveLoginLink): Promise<boolean> {
    return this.links.take(link);
  }
}
