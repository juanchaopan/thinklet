import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Executor } from '../../infrastructure/database/database.module.js';
import { auditEvents, parents } from '../../infrastructure/database/schema.js';

/** An audit event as it is stored; the parent's Authing identity is read with the insert. */
export type AuditRow = Omit<
  typeof auditEvents.$inferInsert,
  'id' | 'occurredAt' | 'actorIssuer' | 'actorSubject'
>;

/**
 * Writes audit events. It has no connection of its own: every row is
 * written with the executor of the transaction that makes the change, so
 * the row and the change are committed or rolled back together.
 */
@Injectable()
export class AuditRepository {
  /**
   * Adds the row at the database's current time. A parent's issuer and
   * subject are read from their row in the same statement, so the caller
   * needs only the parent's id; a parent deleted earlier in the
   * transaction has none left to read.
   */
  async insert(transaction: Executor, row: AuditRow): Promise<void> {
    const { actorId } = row;
    const ofParent = (column: PgColumn): SQL<string> | null =>
      row.actorKind === 'parent' && actorId != null
        ? sql<string>`(select ${column} from ${parents} where ${parents.id} = ${actorId})`
        : null;
    await transaction.insert(auditEvents).values({
      ...row,
      actorIssuer: ofParent(parents.oidcIssuer),
      actorSubject: ofParent(parents.oidcSubject),
    });
  }
}
