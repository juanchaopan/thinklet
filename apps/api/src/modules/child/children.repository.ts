import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ChildDataCipher } from '../../infrastructure/child-data/child-data-cipher.js';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { translatingUniqueViolation } from '../../infrastructure/database/unique-violation.js';

const { children, childDevices } = schema;

/** The unique constraint that keeps a child's account unique within the family. */
const ACCOUNT_UNIQUE = 'children_family_account_unique';

/** Another child of the family has the account. The statement it happened in is aborted. */
export class AccountTakenError extends Error {
  constructor(options?: ErrorOptions) {
    super('The account is taken in the family', options);
    this.name = 'AccountTakenError';
  }
}

/** A child as the parents see it, in plain text. */
export interface ChildRecord {
  id: string;
  nickname: string;
  account: string;
}

export interface NewChild {
  familyId: string;
  nickname: string;
  account: string;
}

/** A change to a child; a field left out keeps its value. */
export interface ChildChanges {
  nickname?: string;
  account?: string;
}

/** A browser the child is remembered on, its name in plain text. */
export interface DeviceRecord {
  id: string;
  name: string;
  rememberedAt: Date;
  lastUsedAt: Date;
}

/** The columns a child is read with; the nickname and the account are ciphertexts. */
const childColumns = {
  id: children.id,
  nickname: children.nickname,
  account: children.account,
};

/** The child with the id, only when it belongs to the family. */
const childInFamily = (familyId: string, childId: string) =>
  and(eq(children.id, childId), eq(children.familyId, familyId));

/** Runs a write of a child's account, turning a taken account into AccountTakenError. */
function settingAccount<T>(write: () => Promise<T>): Promise<T> {
  return translatingUniqueViolation(
    ACCOUNT_UNIQUE,
    (options) => new AccountTakenError(options),
    write,
  );
}

/**
 * The queries on children and their devices, on the pool or inside one
 * transaction. The nickname, the account and the device names are
 * encrypted on the way in and decrypted on the way out, each bound to its
 * column and its row's id, so the callers see plain text only and the
 * database ciphertext only. A new child gets its id here rather than from
 * the database, as its ciphertexts are bound to it before the row exists.
 * Every query of a child names its family as well, so a child of another
 * family is not found. The times a child's logins are compared with are
 * the database's (`.docs/design/data.md`, "children"), the clock the
 * logins are issued by, never an api instance's.
 */
export class ChildStore {
  constructor(
    protected readonly executor: Executor,
    protected readonly cipher: ChildDataCipher,
  ) {}

  async childExists(familyId: string, childId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ id: children.id })
      .from(children)
      .where(childInFamily(familyId, childId));
    return rows.length > 0;
  }

  /**
   * Locks the child's row until the transaction ends, so the changes to one
   * child, its password and its login links, run one after another.
   * Returns whether the family has the child.
   */
  async lockChild(familyId: string, childId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ id: children.id })
      .from(children)
      .where(childInFamily(familyId, childId))
      .for('update');
    return rows.length > 0;
  }

  async findChild(familyId: string, childId: string): Promise<ChildRecord | undefined> {
    const rows = await this.executor
      .select(childColumns)
      .from(children)
      .where(childInFamily(familyId, childId));
    return this.readChildren(rows).at(0);
  }

  /** The family's children in the order they were added. */
  async listChildren(familyId: string): Promise<ChildRecord[]> {
    const rows = await this.executor
      .select(childColumns)
      .from(children)
      .where(eq(children.familyId, familyId))
      .orderBy(asc(children.createdAt), asc(children.id));
    return this.readChildren(rows);
  }

  /**
   * Adds the child without a password, refusing logins issued before the
   * database's time of the adding; throws AccountTakenError when another
   * child of the family has the account. The child is returned from what
   * was written.
   */
  async insertChild(child: NewChild): Promise<ChildRecord> {
    const id = randomUUID();
    await settingAccount(() =>
      this.executor.insert(children).values({
        id,
        familyId: child.familyId,
        nickname: this.cipher.encrypt(child.nickname, { column: children.nickname, rowId: id }),
        account: this.cipher.encrypt(child.account, { column: children.account, rowId: id }),
        accountLookup: this.cipher.lookup(child.familyId, child.account),
        sessionsValidAfter: sql`now()`,
      }),
    );
    return { id, nickname: child.nickname, account: child.account };
  }

  /**
   * Changes the nickname, the account or both and returns the child, or
   * undefined when the family has no such child; throws AccountTakenError
   * when another child of the family has the account. A change without
   * either field changes nothing and returns the child as it is.
   */
  async updateChild(
    familyId: string,
    childId: string,
    changes: ChildChanges,
  ): Promise<ChildRecord | undefined> {
    const set: Partial<typeof children.$inferInsert> = {};
    if (changes.nickname !== undefined) {
      set.nickname = this.cipher.encrypt(changes.nickname, {
        column: children.nickname,
        rowId: childId,
      });
    }
    if (changes.account !== undefined) {
      set.account = this.cipher.encrypt(changes.account, {
        column: children.account,
        rowId: childId,
      });
      set.accountLookup = this.cipher.lookup(familyId, changes.account);
    }
    if (Object.keys(set).length === 0) {
      return this.findChild(familyId, childId);
    }
    const rows = await settingAccount(() =>
      this.executor
        .update(children)
        .set(set)
        .where(childInFamily(familyId, childId))
        .returning(childColumns),
    );
    return this.readChildren(rows).at(0);
  }

  /** Deletes the child, whose devices go with it; returns whether there was one. */
  async deleteChild(familyId: string, childId: string): Promise<boolean> {
    const rows = await this.executor
      .delete(children)
      .where(childInFamily(familyId, childId))
      .returning({ id: children.id });
    return rows.length > 0;
  }

  /**
   * Clears the child's password and refuses every login issued until now
   * by the database's clock, which the statement reads as it runs, after
   * the lock the caller took on the child. The time stored is the next
   * whole second: a JWT carries its issue time in whole seconds, so a login
   * issued earlier in the reset's own second carries that second, and only
   * the next one refuses it. A login made after the reset within the rest
   * of that second is refused as well, which loses nothing in practice:
   * the reset clears the password and forgets every remembered browser, so
   * the child logs in again only by setting a new password, which takes
   * far longer. Returns whether the family has the child.
   */
  async clearPassword(familyId: string, childId: string): Promise<boolean> {
    const rows = await this.executor
      .update(children)
      .set({
        passwordHash: null,
        sessionsValidAfter: sql`date_trunc('second', clock_timestamp()) + interval '1 second'`,
      })
      .where(childInFamily(familyId, childId))
      .returning({ id: children.id });
    return rows.length > 0;
  }

  /** The browsers the child is remembered on, the latest login first. */
  async listDevices(childId: string): Promise<DeviceRecord[]> {
    const rows = await this.executor
      .select({
        id: childDevices.id,
        name: childDevices.name,
        rememberedAt: childDevices.rememberedAt,
        lastUsedAt: childDevices.lastUsedAt,
      })
      .from(childDevices)
      .where(eq(childDevices.childId, childId))
      .orderBy(desc(childDevices.lastUsedAt), asc(childDevices.id));
    return rows.map((row) => ({
      ...row,
      name: this.cipher.decrypt(row.name, { column: childDevices.name, rowId: row.id }),
    }));
  }

  /**
   * Forgets one browser of the child and returns whether there was one; a
   * device that is gone already is no change.
   */
  async deleteDevice(childId: string, deviceId: string): Promise<boolean> {
    const rows = await this.executor
      .delete(childDevices)
      .where(and(eq(childDevices.id, deviceId), eq(childDevices.childId, childId)))
      .returning({ id: childDevices.id });
    return rows.length > 0;
  }

  /** Forgets every browser of the child and returns how many there were. */
  async deleteDevices(childId: string): Promise<number> {
    const rows = await this.executor
      .delete(childDevices)
      .where(eq(childDevices.childId, childId))
      .returning({ id: childDevices.id });
    return rows.length;
  }

  private readChildren(rows: ChildRecord[]): ChildRecord[] {
    return rows.map((row) => ({
      id: row.id,
      nickname: this.cipher.decrypt(row.nickname, { column: children.nickname, rowId: row.id }),
      account: this.cipher.decrypt(row.account, { column: children.account, rowId: row.id }),
    }));
  }
}

/**
 * Children and their devices. Its own queries run on the pool;
 * `transaction` runs a unit of work with the same queries inside one
 * transaction, and hands the work the transaction too, for the audit event
 * of its change.
 */
@Injectable()
export class ChildrenRepository extends ChildStore {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    cipher: ChildDataCipher,
  ) {
    super(database, cipher);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: ChildStore, transaction: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new ChildStore(transaction, this.cipher), transaction),
    );
  }
}
