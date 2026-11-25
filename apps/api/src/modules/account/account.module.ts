import { Module } from '@nestjs/common';
import { IdentityProviderModule } from '../../infrastructure/identity-provider/identity-provider.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChildModule } from '../child/child.module.js';
import { FamilyModule } from '../family/family.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthingWebhookController } from './authing-webhook.controller.js';

/**
 * Deleting parents' accounts (decision 0038): a parent's own deletion,
 * `DELETE /api/me`, and Authing's notification of users deleted in its
 * console, `POST /api/webhooks/authing`. It joins what the deletion
 * touches in other modules: Authing's management API, the family module's
 * ParentDeletionService for the parent's data and families, the child
 * module's ChildrenService for the login links of children deleted with a
 * family, and the auth module's ParentSessionService to end the login.
 */
@Module({
  imports: [IdentityProviderModule, AuthModule, FamilyModule, ChildModule],
  controllers: [AccountController, AuthingWebhookController],
  providers: [AccountService],
})
export class AccountModule {}
