import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddChildRequest,
  Child,
  ChildDevice,
  ChildLoginLink,
  ChildLoginLinkStatusResponse,
  UpdateChildRequest,
} from '@thinklet/contracts';
import type { Environment } from '../../infrastructure/config/environment.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { AuditService, byParent, changedFields, type AuditActor } from '../audit/audit.service.js';
import {
  AccountTakenError,
  ChildrenRepository,
  type ChildRecord,
  type ChildStore,
  type DeviceRecord,
} from './children.repository.js';
import {
  LOGIN_LINK_LIFETIME_MS,
  LoginLinks,
  type LoginLinkState,
  type NewLoginLink,
} from './login-links.js';
import { newToken } from './tokens.js';

/**
 * The version of the guardian's consent a parent ticks when adding a child
 * (`.docs/design/rules.md`, "孩子"), recorded with the child's creation.
 */
export const CHILD_CONSENT_VERSION = '2026-11-22';

/** The page a login link opens, under the site's origin; the token follows it. */
const LOGIN_LINK_PATH = '/child/qr/';

/** A child of another family and a deleted child are answered the same, so ids reveal nothing. */
export const childNotFound = () => new ApiError('child_not_found', HttpStatus.NOT_FOUND);

/** A login link of another child. */
export const linkNotFound = () => new ApiError('not_found', HttpStatus.NOT_FOUND);

const accountTaken = () => new ApiError('account_taken', HttpStatus.CONFLICT);

/**
 * What a parent is told of a login link whose state was read at `now`
 * (`.docs/design/data.md`, "Redis 里的"): its stored state, or `expired`
 * once the state is gone. The state's key lives exactly as long as the
 * link, so a link without one expired by now; when exactly is gone with
 * the key, and `now` is the latest it can have been.
 */
export function loginLinkStatus(
  state: LoginLinkState | undefined,
  now: Date,
): ChildLoginLinkStatusResponse {
  return state === undefined
    ? { status: 'expired', expiresAt: now.toISOString() }
    : { status: state.status, expiresAt: state.expiresAt };
}

/** A child as the parents see it, with the time left for setting a password as an ISO date-time. */
export function toChild(record: ChildRecord): Child {
  return {
    id: record.id,
    nickname: record.nickname,
    account: record.account,
    passwordSet: record.passwordSet,
    passwordSetupUntil: record.passwordSetupUntil?.toISOString() ?? null,
  };
}

/** A remembered browser with its times as ISO date-times. */
export function toDevice(record: DeviceRecord): ChildDevice {
  return {
    id: record.id,
    name: record.name,
    rememberedAt: record.rememberedAt.toISOString(),
    lastUsedAt: record.lastUsedAt.toISOString(),
  };
}

/** The fields a change of a child names, in a fixed order, for its audit event. */
export function changedChildFields(changes: UpdateChildRequest): Array<'nickname' | 'account'> {
  return changedFields(changes, ['nickname', 'account']);
}

/** Who acted on which child of which family, the part every child's audit event shares. */
function onChild(
  parentId: string,
  familyId: string,
  childId: string,
): { actor: AuditActor; targetId: string; familyId: string } {
  return { actor: byParent(parentId), targetId: childId, familyId };
}

/** Runs a write of a child's account, answering a taken account with 409 `account_taken`. */
async function claimingAccount<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof AccountTakenError) {
      throw accountTaken();
    }
    throw error;
  }
}

/**
 * The children of a family as its parents manage them
 * (`.docs/design/interfaces.md`, "孩子（家长）"). Every member of the
 * family may use it, the admin and the other parents alike; the routes'
 * membership check runs before it. A child is always looked up within the
 * family, so a child of another family is not found. What the parents see
 * of a child includes whether it has set a password and, while it has
 * not, until when it may set one with the account. Every change is
 * recorded as an audit event of the parent in its transaction; one that
 * changes nothing is not. The login links live in Redis, in LoginLinks;
 * other modules that delete children, with their family, remove the
 * children's links through `removeLoginLinksOf`.
 */
@Injectable()
export class ChildrenService {
  private readonly appOrigin: string;

  constructor(
    private readonly repository: ChildrenRepository,
    private readonly audit: AuditService,
    private readonly links: LoginLinks,
    config: ConfigService<Environment, true>,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
  }

  /** The family's children in the order they were added. */
  async list(familyId: string): Promise<Child[]> {
    return (await this.repository.listChildren(familyId)).map(toChild);
  }

  /**
   * Adds a child without a password, who has 48 hours to set one by
   * logging in with the family code and the account. The guardian's
   * consent of the parent who adds it is the audit event of the addition,
   * with the consent's version.
   */
  add(parentId: string, familyId: string, request: AddChildRequest): Promise<Child> {
    return claimingAccount(() =>
      this.repository.transaction(async (store, transaction) => {
        const child = await store.insertChild({
          familyId,
          nickname: request.nickname,
          account: request.account,
        });
        await this.audit.record(transaction, {
          ...onChild(parentId, familyId, child.id),
          action: 'child.created',
          details: { consentVersion: CHILD_CONSENT_VERSION },
        });
        return toChild(child);
      }),
    );
  }

  /** Changes the nickname, the account or both; the last change saved wins. */
  update(
    parentId: string,
    familyId: string,
    childId: string,
    changes: UpdateChildRequest,
  ): Promise<Child> {
    return claimingAccount(() =>
      this.repository.transaction(async (store, transaction) => {
        const record = await store.updateChild(familyId, childId, changes);
        if (record === undefined) {
          throw childNotFound();
        }
        const fields = changedChildFields(changes);
        if (fields.length > 0) {
          await this.audit.record(transaction, {
            ...onChild(parentId, familyId, childId),
            action: 'child.updated',
            details: { fields },
          });
        }
        return toChild(record);
      }),
    );
  }

  /**
   * Deletes the child with its devices in one transaction, then the
   * child's login link in Redis; the child's audit events stay.
   */
  async remove(parentId: string, familyId: string, childId: string): Promise<void> {
    await this.repository.transaction(async (store, transaction) => {
      if (!(await store.deleteChild(familyId, childId))) {
        throw childNotFound();
      }
      await this.audit.record(transaction, {
        ...onChild(parentId, familyId, childId),
        action: 'child.deleted',
      });
    });
    await this.removeLoginLinksOf([childId]);
  }

  /**
   * Removes the login links in Redis of children already deleted, such as
   * those of a family deleted with them, once their deletion has
   * committed. A failure of Redis is logged, not thrown: a link of a
   * deleted child cannot be used, and its keys run out within minutes.
   */
  removeLoginLinksOf(childIds: readonly string[]): Promise<void> {
    return this.links.removeOf(childIds);
  }

  /**
   * Resets the child's password in one transaction: the password is
   * cleared, the child has 48 hours to set a new one by logging in with
   * the family code and the account, every login issued so far is refused
   * and every remembered browser forgotten. A login link not used yet
   * keeps working, so the child may set the new password with it as well.
   * The child's row is locked before the database's clock gives the time
   * of the reset, so a login holding the lock finishes first and its
   * session, issued by the same clock before that time, is refused.
   */
  resetPassword(parentId: string, familyId: string, childId: string): Promise<void> {
    return this.repository.transaction(async (store, transaction) => {
      if (!(await store.lockChild(familyId, childId))) {
        throw childNotFound();
      }
      await store.clearPassword(familyId, childId);
      await store.deleteDevices(childId);
      await this.audit.record(transaction, {
        ...onChild(parentId, familyId, childId),
        action: 'child.password_reset',
      });
    });
  }

  /**
   * Makes a login link for the child, valid for 10 minutes and once; the
   * child's older link stops working. The link is stored in Redis last in
   * the transaction of its audit event, holding the child's row lock, so
   * one child's links are made one after another, and a link Redis does
   * not take leaves no audit event. A link stored whose transaction then
   * does not commit is discarded from Redis, so no link works without its
   * audit event. The token is in the answer's URL only; Redis keeps its
   * hash.
   */
  async createLoginLink(
    parentId: string,
    familyId: string,
    childId: string,
  ): Promise<ChildLoginLink> {
    const { token, hash } = newToken();
    const link: NewLoginLink = {
      linkId: randomUUID(),
      childId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + LOGIN_LINK_LIFETIME_MS),
    };
    const making = { stored: false };
    try {
      await this.repository.transaction(async (store, transaction) => {
        if (!(await store.lockChild(familyId, childId))) {
          throw childNotFound();
        }
        await this.audit.record(transaction, {
          ...onChild(parentId, familyId, childId),
          action: 'child.login_link_created',
        });
        await this.links.create(link);
        making.stored = true;
      });
    } catch (error) {
      if (making.stored) {
        await this.links.discard(link);
      }
      throw error;
    }
    return {
      id: link.linkId,
      url: `${this.appOrigin}${LOGIN_LINK_PATH}${token}`,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * The state of one of the child's login links, for the QR code dialog to
   * follow. Redis is read only once the family is known to have the child.
   */
  async getLoginLinkStatus(
    familyId: string,
    childId: string,
    linkId: string,
  ): Promise<ChildLoginLinkStatusResponse> {
    await requireChild(this.repository, familyId, childId);
    const state = await this.links.state(linkId);
    if (state !== undefined && state.childId !== childId) {
      throw linkNotFound();
    }
    return loginLinkStatus(state, new Date());
  }

  /** The browsers the child is remembered on, the latest login first. */
  async listDevices(familyId: string, childId: string): Promise<ChildDevice[]> {
    await requireChild(this.repository, familyId, childId);
    return (await this.repository.listDevices(childId)).map(toDevice);
  }

  /**
   * Forgets one browser of the child. A device that is gone already, or an
   * id that names no device, leaves nothing to do and is not an error.
   */
  revokeDevice(
    parentId: string,
    familyId: string,
    childId: string,
    deviceId: string | undefined,
  ): Promise<void> {
    return this.repository.transaction(async (store, transaction) => {
      await requireChild(store, familyId, childId);
      if (deviceId !== undefined && (await store.deleteDevice(childId, deviceId))) {
        await this.audit.record(transaction, {
          ...onChild(parentId, familyId, childId),
          action: 'child.devices_revoked',
          details: { deviceId },
        });
      }
    });
  }

  /** Forgets every browser of the child; a child remembered nowhere leaves nothing to do. */
  revokeAllDevices(parentId: string, familyId: string, childId: string): Promise<void> {
    return this.repository.transaction(async (store, transaction) => {
      await requireChild(store, familyId, childId);
      if ((await store.deleteDevices(childId)) > 0) {
        await this.audit.record(transaction, {
          ...onChild(parentId, familyId, childId),
          action: 'child.devices_revoked',
          details: {},
        });
      }
    });
  }
}

/** Checks with the store's queries that the family has the child; else 404 `child_not_found`. */
async function requireChild(store: ChildStore, familyId: string, childId: string): Promise<void> {
  if (!(await store.childExists(familyId, childId))) {
    throw childNotFound();
  }
}
