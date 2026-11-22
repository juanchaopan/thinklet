import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from '../../infrastructure/csrf/origin.guard.js';
import { FamilyModule } from '../family/family.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ChildSessionService } from './child-session.service.js';
import { OidcService } from './oidc.service.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * The parent's login and logout, the child's login state, and the checks
 * every request passes. The global guards run in the order listed: the
 * Origin check first, then the login check. ChildSessionService is exported
 * for the child module, which signs children in and out and completes the
 * login check of the child routes with its own check of the child.
 */
@Module({
  imports: [FamilyModule],
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    OidcService,
    SessionTokensService,
    AuthService,
    ChildSessionService,
  ],
  exports: [ChildSessionService],
})
export class AuthModule {}
