import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import { AuthingManagement } from './authing-management.js';
import { AuthingWebhookGuard } from './authing-webhook.guard.js';

/**
 * Authing beyond the login (decision 0038): its management API, which
 * deletes a parent's account, and the check of the secret its webhook
 * carries.
 */
@Module({
  providers: [
    {
      provide: AuthingManagement,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new AuthingManagement({
          origin: config.get('AUTHING_MANAGEMENT_ORIGIN', { infer: true }),
          userPoolId: config.get('AUTHING_USER_POOL_ID', { infer: true }),
          userPoolSecret: config.get('AUTHING_USER_POOL_SECRET', { infer: true }),
        }),
    },
    AuthingWebhookGuard,
  ],
  exports: [AuthingManagement, AuthingWebhookGuard],
})
export class IdentityProviderModule {}
