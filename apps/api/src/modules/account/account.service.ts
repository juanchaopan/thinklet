import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../infrastructure/config/environment.js';
import { ApiError, StillAdminError } from '../../infrastructure/errors/api-error.js';
import {
  AuthingManagement,
  IdentityProviderError,
} from '../../infrastructure/identity-provider/authing-management.js';
import { ChildrenService } from '../child/children.service.js';
import { ParentDeletionService } from '../family/parent-deletion.service.js';

/**
 * Deleting parents' accounts (`.docs/design/interfaces.md`, "DELETE /api/me"
 * and "Authing 的通知"; decision 0038), at Authing and on this site.
 *
 * A parent deletes their own account only while they are no family's
 * admin. Authing deletes it first: when Authing fails or does not answer,
 * nothing is deleted here either, and the parent is told
 * `identity_provider_failed`. Once Authing has deleted it, the parent's
 * data here goes in one transaction. Authing then also reports the
 * deletion with its webhook, which finds no one left.
 *
 * A parent deleted in Authing's console is reported by the webhook alone,
 * by their subject at the configured issuer, and their data here goes the
 * same way, families they ran handed over or deleted. Every deletion that
 * deleted children removes the children's login links from Redis after it
 * has committed.
 */
@Injectable()
export class AccountService {
  private readonly issuer: string;

  constructor(
    private readonly parents: ParentDeletionService,
    private readonly children: ChildrenService,
    private readonly authing: AuthingManagement,
    config: ConfigService<Environment, true>,
  ) {
    this.issuer = config.get('OIDC_ISSUER', { infer: true });
  }

  /**
   * Deletes the signed-in parent's own account, at Authing and here. A
   * parent who is gone already is not signed in (401); one who is still a
   * family's admin is answered 409 `still_admin` with those families.
   */
  async deleteOwnAccount(parentId: string): Promise<void> {
    const account = await this.parents.accountOf(parentId);
    if (account === undefined) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    if (account.adminFamilies.length > 0) {
      throw new StillAdminError(account.adminFamilies);
    }
    try {
      await this.authing.deleteUser(account.subject);
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        throw new ApiError('identity_provider_failed', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
    const deleted = await this.parents.deleteOwnAccount(parentId);
    await this.children.removeLoginLinksOf(deleted?.childIds ?? []);
  }

  /** Deletes here, one after another, the parents Authing reports deleted, by their user ids. */
  async deleteReportedUsers(userIds: readonly string[]): Promise<void> {
    for (const userId of userIds) {
      const deleted = await this.parents.deleteReportedAccount(this.issuer, userId);
      await this.children.removeLoginLinksOf(deleted?.childIds ?? []);
    }
  }
}
