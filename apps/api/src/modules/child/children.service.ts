import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddChildRequest,
  Child,
  ChildDevice,
  ChildLoginLink,
  ChildLoginLinkStatus,
  ChildLoginLinkStatusResponse,
  UpdateChildRequest,
} from '@thinklet/contracts';
import type { Environment } from '../../infrastructure/config/environment.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { sessionsValidAfterReset } from './child.service.js';
import {
  AccountTakenError,
  ChildrenRepository,
  type DeviceRecord,
  type LoginLinkRecord,
} from './children.repository.js';
import { newToken } from './tokens.js';

/**
 * The version of the guardian's consent a parent ticks when adding a child
 * (`.docs/design/rules.md`, "孩子"), kept with the child.
 */
export const CHILD_CONSENT_VERSION = '2026-11-22';

/** How long a login link works after it is made (`.docs/design/rules.md`, "登录二维码"). */
export const LOGIN_LINK_LIFETIME_MS = 10 * 60 * 1000;

/** The page a login link opens, under the site's origin; the token follows it. */
const LOGIN_LINK_PATH = '/child/qr/';

/** A child of another family and a deleted child are answered the same, so ids reveal nothing. */
export const childNotFound = () => new ApiError('child_not_found', HttpStatus.NOT_FOUND);

/** A login link that does not exist or is another child's. */
export const linkNotFound = () => new ApiError('not_found', HttpStatus.NOT_FOUND);

const accountTaken = () => new ApiError('account_taken', HttpStatus.CONFLICT);

/**
 * The state of a login link at `now` (`.docs/design/data.md`,
 * "child_login_links"), checked in this order: used, revoked, expired,
 * else active. A link is expired from its expiry time on.
 */
export function loginLinkStatus(link: LoginLinkRecord, now: Date): ChildLoginLinkStatus {
  if (link.usedAt !== null) {
    return 'used';
  }
  if (link.revokedAt !== null) {
    return 'revoked';
  }
  return link.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
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
 * family, so a child of another family is not found. The repository's
 * child records are what the parents see of a child.
 */
@Injectable()
export class ChildrenService {
  private readonly appOrigin: string;

  constructor(
    private readonly repository: ChildrenRepository,
    config: ConfigService<Environment, true>,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
  }

  /** The family's children in the order they were added. */
  list(familyId: string): Promise<Child[]> {
    return this.repository.listChildren(familyId);
  }

  /**
   * Adds a child without a password, with the guardian's consent of the
   * parent who adds it: the parent, the time and the consent's version.
   */
  add(parentId: string, familyId: string, request: AddChildRequest): Promise<Child> {
    return claimingAccount(() =>
      this.repository.insertChild({
        familyId,
        nickname: request.nickname,
        account: request.account,
        consentParentId: parentId,
        consentVersion: CHILD_CONSENT_VERSION,
        consentedAt: new Date(),
      }),
    );
  }

  /** Changes the nickname, the account or both; the last change saved wins. */
  async update(familyId: string, childId: string, changes: UpdateChildRequest): Promise<Child> {
    const record = await claimingAccount(() =>
      this.repository.updateChild(familyId, childId, changes),
    );
    if (record === undefined) {
      throw childNotFound();
    }
    return record;
  }

  /** Deletes the child with its consent, its login links and its devices. */
  async remove(familyId: string, childId: string): Promise<void> {
    if (!(await this.repository.deleteChild(familyId, childId))) {
      throw childNotFound();
    }
  }

  /**
   * Resets the child's password in one transaction: the password is
   * cleared, every login issued so far is refused and every remembered
   * browser forgotten. Login links not used yet keep working, so the child
   * sets a new password with the next one. The child's row is locked
   * before the time of the reset is taken, so a login holding the lock
   * finishes first and its session, issued before that time, is refused.
   */
  resetPassword(familyId: string, childId: string): Promise<void> {
    return this.repository.transaction(async (store) => {
      if (!(await store.lockChild(familyId, childId))) {
        throw childNotFound();
      }
      await store.clearPassword(familyId, childId, sessionsValidAfterReset(new Date()));
      await store.deleteDevices(childId);
    });
  }

  /**
   * Makes a login link for the child, valid for 10 minutes and once. The
   * child's links still active are revoked in the same transaction, under
   * the child's lock, so only the newest link ever works. The token is in
   * the answer's URL only; the database keeps its hash.
   */
  async createLoginLink(
    parentId: string,
    familyId: string,
    childId: string,
  ): Promise<ChildLoginLink> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOGIN_LINK_LIFETIME_MS);
    const { token, hash } = newToken();
    const id = await this.repository.transaction(async (store) => {
      if (!(await store.lockChild(familyId, childId))) {
        throw childNotFound();
      }
      await store.revokeActiveLinks(childId, now);
      return store.insertLoginLink({
        childId,
        tokenHash: hash,
        createdBy: parentId,
        createdAt: now,
        expiresAt,
      });
    });
    return {
      id,
      url: `${this.appOrigin}${LOGIN_LINK_PATH}${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The state of one of the child's login links, for the QR code dialog to follow. */
  async getLoginLinkStatus(
    familyId: string,
    childId: string,
    linkId: string,
  ): Promise<ChildLoginLinkStatusResponse> {
    await this.requireChild(familyId, childId);
    const link = await this.repository.findLoginLink(childId, linkId);
    if (link === undefined) {
      throw linkNotFound();
    }
    return { status: loginLinkStatus(link, new Date()), expiresAt: link.expiresAt.toISOString() };
  }

  /** The browsers the child is remembered on, the latest login first. */
  async listDevices(familyId: string, childId: string): Promise<ChildDevice[]> {
    await this.requireChild(familyId, childId);
    return (await this.repository.listDevices(childId)).map(toDevice);
  }

  /**
   * Forgets one browser of the child. A device that is gone already, or an
   * id that names no device, leaves nothing to do and is not an error.
   */
  async revokeDevice(
    familyId: string,
    childId: string,
    deviceId: string | undefined,
  ): Promise<void> {
    await this.requireChild(familyId, childId);
    if (deviceId !== undefined) {
      await this.repository.deleteDevice(childId, deviceId);
    }
  }

  /** Forgets every browser of the child. */
  async revokeAllDevices(familyId: string, childId: string): Promise<void> {
    await this.requireChild(familyId, childId);
    await this.repository.deleteDevices(childId);
  }

  private async requireChild(familyId: string, childId: string): Promise<void> {
    if (!(await this.repository.childExists(familyId, childId))) {
      throw childNotFound();
    }
  }
}
