import { Injectable } from '@nestjs/common';
import type { Executor } from '../../infrastructure/database/database.module.js';
import { AuditRepository, type AuditRow } from './audit.repository.js';

/** Who did what an audit event records: a parent or a child by their id, or the site itself. */
export type AuditActor =
  { kind: 'parent'; id: string } | { kind: 'child'; id: string } | { kind: 'system' };

/** The parent with the id as the one who acted. */
export const byParent = (id: string): AuditActor => ({ kind: 'parent', id });

/** The child with the id as the one who acted. */
export const byChild = (id: string): AuditActor => ({ kind: 'child', id });

/** The site itself as the one who acted, as on a notification from Authing. */
export const BY_SYSTEM: AuditActor = { kind: 'system' };

/**
 * Every action an audit event records, with the kind of thing it is done
 * to (`.docs/design/data.md`, "audit_events"). A family member is named
 * by their parent id, a book by its book id.
 */
export const AUDIT_TARGET_KINDS = {
  'parent.created': 'parent',
  'parent.renamed': 'parent',
  'parent.deleted': 'parent',
  'family.created': 'family',
  'family.updated': 'family',
  'family.code_changed': 'family',
  'family.deleted': 'family',
  'member.admin_transferred': 'member',
  'member.removed': 'member',
  'member.left': 'member',
  'join_request.created': 'join_request',
  'join_request.withdrawn': 'join_request',
  'join_request.dismissed': 'join_request',
  'join_request.approved': 'join_request',
  'join_request.rejected': 'join_request',
  'child.created': 'child',
  'child.updated': 'child',
  'child.deleted': 'child',
  'child.password_reset': 'child',
  'child.password_set': 'child',
  'child.login_link_created': 'child',
  'child.devices_revoked': 'child',
  'book.acquired': 'book',
  'book.removed': 'book',
  'book.readers_changed': 'book',
} as const;

export type AuditAction = keyof typeof AUDIT_TARGET_KINDS;

/**
 * The details of the actions that have any. They hold ids, versions and
 * the names of the fields changed only, never what a field was changed to.
 */
export interface AuditDetails {
  'parent.deleted': { via: 'self' | 'webhook' };
  'family.updated': { fields: Array<'name' | 'timezone'> };
  'family.deleted': { children: number; members: number };
  /** The parent id of the admin before. */
  'member.admin_transferred': { from: string };
  /** The applicant's parent id. */
  'join_request.approved': { parentId: string };
  'join_request.rejected': { parentId: string };
  /** The version of the guardian's consent the parent ticked. */
  'child.created': { consentVersion: string };
  'child.updated': { fields: Array<'nickname' | 'account'> };
  'child.password_set': { via: 'account' | 'qr' };
  /** The device, when one was revoked rather than all. */
  'child.devices_revoked': { deviceId?: string };
  /** The ids of the children the book was assigned to and taken from. */
  'book.readers_changed': { added: string[]; removed: string[] };
}

/**
 * The fields a change names, in the order of `fields`, for the `fields`
 * detail of its audit event: the names only, never the values.
 */
export function changedFields<Field extends string>(
  changes: Partial<Record<Field, unknown>>,
  fields: readonly Field[],
): Field[] {
  return fields.filter((field) => changes[field] !== undefined);
}

/** What an action is, whom it was done to and in which family; null for an action outside any family. */
interface AuditEventOf<A extends AuditAction> {
  actor: AuditActor;
  action: A;
  targetId: string;
  familyId: string | null;
}

/** An action to record; the actions with details name them, the others have none. */
export type AuditEvent = {
  [A in AuditAction]: AuditEventOf<A> &
    (A extends keyof AuditDetails ? { details: AuditDetails[A] } : { details?: never });
}[AuditAction];

/** The row an event is stored as. */
export function toAuditRow(event: AuditEvent): AuditRow {
  const { actor } = event;
  return {
    actorKind: actor.kind,
    actorId: actor.kind === 'system' ? null : actor.id,
    action: event.action,
    targetKind: AUDIT_TARGET_KINDS[event.action],
    targetId: event.targetId,
    familyId: event.familyId,
    details: event.details ?? {},
  };
}

/**
 * The audit events (`.docs/design/data.md`, "audit_events"): one row for
 * every action that changes data, written by the module that makes the
 * change, inside its own transaction, so the row is there exactly when
 * the change is. Logins, logouts and reads are not recorded.
 */
@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  /** Records the event with the transaction that makes the change. */
  record(transaction: Executor, event: AuditEvent): Promise<void> {
    return this.repository.insert(transaction, toAuditRow(event));
  }
}
