import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { ChildDataCipher } from '../../infrastructure/child-data/child-data-cipher.js';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import { translatingUniqueViolation } from '../../infrastructure/database/unique-violation.js';

const { children, childLoginLinks, childDevices } = schema;

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
  /** The parent who ticked the guardian's consent, and the version and time of it. */
  consentParentId: string;
  consentVersion: string;
  consentedAt: Date;
}

/** A change to a child; a field left out keeps its value. */
export interface ChildChanges {
  nickname?: string;
  account?: string;
}

export interface NewLoginLink {
  childId: string;
  tokenHash: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
}

/** The times a login link's state is read from. */
export interface LoginLinkRecord {
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
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
 * The queries on children, their login links and their devices, on the
 * pool or inside one transaction. The nickname, the account and the device
 * names are encrypted on the way in and decrypted on the way out, so the
 * callers see plain text only and the database ciphertext only. Every
 * query of a child names its family as well, so a child of another family
 * is not found.
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
   * child's login links run one after another. Returns whether the family
   * has the child.
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
   * Adds the child without a password, refusing logins issued before its
   * consent; throws AccountTakenError when another child of the family has
   * the account. The child is returned from what was written, so only its
   * id is read back.
   */
  async insertChild(child: NewChild): Promise<ChildRecord> {
    const rows = await settingAccount(() =>
      this.executor
        .insert(children)
        .values({
          familyId: child.familyId,
          nickname: this.cipher.encrypt(child.nickname),
          account: this.cipher.encrypt(child.account),
          accountLookup: this.cipher.lookup(child.familyId, child.account),
          sessionsValidAfter: child.consentedAt,
          consentParentId: child.consentParentId,
          consentVersion: child.consentVersion,
          consentedAt: child.consentedAt,
        })
        .returning({ id: children.id }),
    );
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Adding the child returned no row');
    }
    return { id: row.id, nickname: child.nickname, account: child.account };
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
      set.nickname = this.cipher.encrypt(changes.nickname);
    }
    if (changes.account !== undefined) {
      set.account = this.cipher.encrypt(changes.account);
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

  /** Deletes the child, whose login links and devices go with it; returns whether there was one. */
  async deleteChild(familyId: string, childId: string): Promise<boolean> {
    const rows = await this.executor
      .delete(children)
      .where(childInFamily(familyId, childId))
      .returning({ id: children.id });
    return rows.length > 0;
  }

  /**
   * Clears the child's password and refuses every login issued before the
   * given time; returns whether the family has the child.
   */
  async clearPassword(familyId: string, childId: string, at: Date): Promise<boolean> {
    const rows = await this.executor
      .update(children)
      .set({ passwordHash: null, sessionsValidAfter: at })
      .where(childInFamily(familyId, childId))
      .returning({ id: children.id });
    return rows.length > 0;
  }

  /** Revokes the child's links that are still active at the given time: unused, unrevoked, unexpired. */
  async revokeActiveLinks(childId: string, at: Date): Promise<void> {
    await this.executor
      .update(childLoginLinks)
      .set({ revokedAt: at })
      .where(
        and(
          eq(childLoginLinks.childId, childId),
          isNull(childLoginLinks.usedAt),
          isNull(childLoginLinks.revokedAt),
          gt(childLoginLinks.expiresAt, at),
        ),
      );
  }

  /** Records a login link and returns its id. */
  async insertLoginLink(link: NewLoginLink): Promise<string> {
    const rows = await this.executor
      .insert(childLoginLinks)
      .values(link)
      .returning({ id: childLoginLinks.id });
    const row = rows.at(0);
    if (row === undefined) {
      throw new Error('Recording the login link returned no row');
    }
    return row.id;
  }

  /** The child's login link with the id, or undefined when the child has none such. */
  async findLoginLink(childId: string, linkId: string): Promise<LoginLinkRecord | undefined> {
    const rows = await this.executor
      .select({
        expiresAt: childLoginLinks.expiresAt,
        usedAt: childLoginLinks.usedAt,
        revokedAt: childLoginLinks.revokedAt,
      })
      .from(childLoginLinks)
      .where(and(eq(childLoginLinks.id, linkId), eq(childLoginLinks.childId, childId)));
    return rows.at(0);
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
    return rows.map((row) => ({ ...row, name: this.cipher.decrypt(row.name) }));
  }

  /** Forgets one browser of the child; one that is gone already is no change. */
  async deleteDevice(childId: string, deviceId: string): Promise<void> {
    await this.executor
      .delete(childDevices)
      .where(and(eq(childDevices.id, deviceId), eq(childDevices.childId, childId)));
  }

  /** Forgets every browser of the child. */
  async deleteDevices(childId: string): Promise<void> {
    await this.executor.delete(childDevices).where(eq(childDevices.childId, childId));
  }

  private readChildren(rows: ChildRecord[]): ChildRecord[] {
    return rows.map((row) => ({
      id: row.id,
      nickname: this.cipher.decrypt(row.nickname),
      account: this.cipher.decrypt(row.account),
    }));
  }
}

/**
 * Children, their login links and their devices. Its own queries run on the
 * pool; `transaction` runs a unit of work with the same queries inside one
 * transaction.
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
  transaction<T>(work: (store: ChildStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new ChildStore(transaction, this.cipher)),
    );
  }
}
