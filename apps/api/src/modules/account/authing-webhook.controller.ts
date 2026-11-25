import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { SkipOriginCheck } from '../../infrastructure/csrf/skip-origin-check.decorator.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { AuthingWebhookGuard } from '../../infrastructure/identity-provider/authing-webhook.guard.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import {
  authingNotificationSchema,
  deletedUserIds,
  type AuthingNotification,
} from './authing-notification.js';

/**
 * `POST /api/webhooks/authing` (`.docs/design/interfaces.md`, "Authing 的通知"):
 * Authing's notifications. Authing's servers send them, so the route needs
 * no login and skips the Origin check; the webhook secret in its header,
 * checked by AuthingWebhookGuard, proves the sender. `user:deleted` deletes
 * the reported parents here; any other event is answered 200 and changes
 * nothing. A parent not found here is passed over, so a notification sent
 * twice changes nothing the second time.
 */
@Public()
@SkipOriginCheck()
@UseGuards(AuthingWebhookGuard)
@Controller('webhooks/authing')
export class AuthingWebhookController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @HttpCode(200)
  async notify(
    @Body(new ZodValidationPipe(authingNotificationSchema)) notification: AuthingNotification,
  ): Promise<void> {
    const userIds = deletedUserIds(notification);
    if (userIds === undefined) {
      throw new ApiError('invalid_request', HttpStatus.BAD_REQUEST, [
        { path: 'data.users', code: 'invalid' },
      ]);
    }
    await this.accounts.deleteReportedUsers(userIds);
  }
}
