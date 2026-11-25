import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { ChildDataCipher } from '../../infrastructure/child-data/child-data-cipher.js';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { LoginLinks, type ActiveLoginLink } from './login-links.js';

const { children, childDevices } = schema;

/** A child as a login checks it: found by the family and the account, or by its id. */
export interface LoginCandidate {
  id: string;
  familyId: string;
  nickname: string;
  /** The argon2id hash of the child's password, or null when the child has none yet. */
  passwordHash: string | null;
}

/** A child the browser remembers, in plain text, with its family to fetch the code of. */
export interface RememberedRecord {
  childId: string;
  familyId: string;
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

const candidateColumns = {
  id: children.id,
  familyId: children.familyId,
  nickname: children.nickname,
  passwordHash: children.passwordHash,
};

/**
 * The queries of a child's login, on the pool or inside one transaction:
 * finding the child by account or by id, the child's password and the
 * check of a signed-in child, and the browsers the child is remembered on.
 * The nickname, the account and the device names are encrypted on the way
 * in and decrypted on the way out, each bound to its column and its row's
 * id.
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
   * The child with its password hash as it is now, its row locked until the
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

  /** The time before which the child's logins are refused, or undefined when the child is gone. */
  async sessionsValidAfter(childId: string): Promise<Date | undefined> {
    const rows = await this.executor
      .select({ sessionsValidAfter: children.sessionsValidAfter })
      .from(children)
      .where(eq(children.id, childId));
    return rows.at(0)?.sessionsValidAfter;
  }

  /** The child's nickname, or undefined when the child is gone. */
  async findNickname(childId: string): Promise<string | undefined> {
    const rows = await this.executor
      .select({ nickname: children.nickname })
      .from(children)
      .where(eq(children.id, childId));
    const row = rows.at(0);
    return row === undefined ? undefined : this.nicknameOf(childId, row.nickname);
  }

  async setPassword(childId: string, passwordHash: string): Promise<void> {
    await this.executor.update(children).set({ passwordHash }).where(eq(children.id, childId));
  }

  /**
   * Remembers the child on the browser with the token's hash, or renews the
   * browser's row: the last login is now and it lasts until `expiresAt`. A
   * row that had expired is remembered anew, as a new device with a new id,
   * time and name; a row still valid keeps its id, when it was first
   * remembered and its name. The name is encrypted for the new id, so a
   * row that takes the new name takes the new id with it.
   */
  async rememberDevice(device: RememberedDevice): Promise<void> {
    const id = randomUUID();
    const lapsed = sql`${childDevices.expiresAt} <= excluded.last_used_at`;
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
          id: sql`case when ${lapsed} then excluded.id else ${childDevices.id} end`,
          rememberedAt: sql`case when ${lapsed} then excluded.remembered_at else ${childDevices.rememberedAt} end`,
          name: sql`case when ${lapsed} then excluded.name else ${childDevices.name} end`,
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

  /** The children the browser with the token's hash remembers at `now`, in the order remembered. */
  async listRemembered(tokenHash: string, now: Date): Promise<RememberedRecord[]> {
    const rows = await this.executor
      .select({
        childId: children.id,
        familyId: children.familyId,
        nickname: children.nickname,
        account: children.account,
      })
      .from(childDevices)
      .innerJoin(children, eq(children.id, childDevices.childId))
      .where(and(eq(childDevices.tokenHash, tokenHash), gt(childDevices.expiresAt, now)))
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
