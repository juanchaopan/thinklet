import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { ChildDataCipher } from '../../infrastructure/child-data/child-data-cipher.js';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';

const { children, childLoginLinks, childDevices } = schema;

/** A child found by the family and the account a login names. */
export interface LoginCandidate {
  id: string;
  nickname: string;
  /** The argon2id hash of the child's password, or null when the child has none yet. */
  passwordHash: string | null;
}

/** A login link found by its token, with what the login needs of its child. */
export interface LinkRecord {
  linkId: string;
  childId: string;
  nickname: string;
  passwordHash: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
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

/**
 * The queries of a child's login, on the pool or inside one transaction:
 * finding the child by account or login link, the child's password and the
 * check of a signed-in child, and the browsers the child is remembered on.
 * The nickname, the account and the device names are encrypted on the way
 * in and decrypted on the way out.
 */
export class ChildLoginStore {
  constructor(
    protected readonly executor: Executor,
    protected readonly cipher: ChildDataCipher,
  ) {}

  /** The family's child with the account, found by its lookup value, or undefined. */
  async findLoginCandidate(familyId: string, account: string): Promise<LoginCandidate | undefined> {
    const rows = await this.executor
      .select({ id: children.id, nickname: children.nickname, passwordHash: children.passwordHash })
      .from(children)
      .where(
        and(
          eq(children.familyId, familyId),
          eq(children.accountLookup, this.cipher.lookup(familyId, account)),
        ),
      );
    const row = rows.at(0);
    return row === undefined ? undefined : { ...row, nickname: this.cipher.decrypt(row.nickname) };
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
    return row === undefined ? undefined : this.cipher.decrypt(row.nickname);
  }

  /** The login link with the token's hash and its child, or undefined when there is none. */
  findLinkByToken(tokenHash: string): Promise<LinkRecord | undefined> {
    return this.linkByToken(tokenHash, false);
  }

  /**
   * The same, with the link's and the child's rows locked until the
   * transaction ends, so the logins on one link, and a password reset of
   * its child, run one after another.
   */
  lockLinkByToken(tokenHash: string): Promise<LinkRecord | undefined> {
    return this.linkByToken(tokenHash, true);
  }

  async setPassword(childId: string, passwordHash: string): Promise<void> {
    await this.executor.update(children).set({ passwordHash }).where(eq(children.id, childId));
  }

  async markLinkUsed(linkId: string, at: Date): Promise<void> {
    await this.executor
      .update(childLoginLinks)
      .set({ usedAt: at })
      .where(eq(childLoginLinks.id, linkId));
  }

  /**
   * Remembers the child on the browser with the token's hash, or renews the
   * browser's row: the last login is now and it lasts until `expiresAt`. A
   * row that had expired is remembered anew, with the new time and name; a
   * row still valid keeps when it was first remembered and its name.
   */
  async rememberDevice(device: RememberedDevice): Promise<void> {
    const lapsed = sql`${childDevices.expiresAt} <= excluded.last_used_at`;
    await this.executor
      .insert(childDevices)
      .values({
        childId: device.childId,
        tokenHash: device.tokenHash,
        name: this.cipher.encrypt(device.name),
        rememberedAt: device.now,
        lastUsedAt: device.now,
        expiresAt: device.expiresAt,
      })
      .onConflictDoUpdate({
        target: [childDevices.childId, childDevices.tokenHash],
        set: {
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
      nickname: this.cipher.decrypt(row.nickname),
      account: this.cipher.decrypt(row.account),
    }));
  }

  private async linkByToken(tokenHash: string, lock: boolean): Promise<LinkRecord | undefined> {
    const query = this.executor
      .select({
        linkId: childLoginLinks.id,
        childId: children.id,
        nickname: children.nickname,
        passwordHash: children.passwordHash,
        expiresAt: childLoginLinks.expiresAt,
        usedAt: childLoginLinks.usedAt,
        revokedAt: childLoginLinks.revokedAt,
      })
      .from(childLoginLinks)
      .innerJoin(children, eq(children.id, childLoginLinks.childId))
      .where(eq(childLoginLinks.tokenHash, tokenHash));
    const rows = lock ? await query.for('update') : await query;
    const row = rows.at(0);
    return row === undefined ? undefined : { ...row, nickname: this.cipher.decrypt(row.nickname) };
  }
}

/**
 * The data of children's logins. Its own queries run on the pool;
 * `transaction` runs a unit of work with the same queries inside one
 * transaction.
 */
@Injectable()
export class ChildLoginRepository extends ChildLoginStore {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    cipher: ChildDataCipher,
  ) {
    super(database, cipher);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: ChildLoginStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new ChildLoginStore(transaction, this.cipher)),
    );
  }
}
