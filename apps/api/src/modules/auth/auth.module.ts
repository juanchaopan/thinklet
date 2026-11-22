import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from '../../infrastructure/csrf/origin.guard.js';
import { FamilyModule } from '../family/family.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * Login, logout and the checks every request passes. The global guards run
 * in the order listed: the Origin check first, then the login check.
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
  ],
})
export class AuthModule {}
