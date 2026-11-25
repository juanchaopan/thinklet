import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from '../../infrastructure/csrf/origin.guard.js';
import { FamilyModule } from '../family/family.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { ChildSessionService } from './child-session.service.js';
import { OidcService } from './oidc.service.js';
import { ParentSessionService } from './parent-session.service.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * The parent's login and logout, the parent's and the child's login state,
 * and the checks every request passes. The global guards run in the order
 * listed: the Origin check first, then the login check. ChildSessionService
 * is exported for the child module, which signs children in and out and
 * completes the login check of the child routes with its own check of the
 * child; it and ParentSessionService are exported for the modules whose
 * routes a signed-in parent and a signed-in child may both use. OidcService
 * is exported for the issuer parents are stored with, which finds the
 * parents the identity provider reports deleted.
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
    ParentSessionService,
    ChildSessionService,
  ],
  exports: [ParentSessionService, ChildSessionService, OidcService],
})
export class AuthModule {}
