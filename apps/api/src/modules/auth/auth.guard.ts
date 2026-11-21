import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { setCurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { IS_PUBLIC } from '../../infrastructure/authentication/public.decorator.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import {
  ID_TOKEN_COOKIE,
  readCookie,
  SESSION_COOKIE,
  setSessionCookies,
} from './session-cookies.js';
import { needsRenewal } from './session-lifetime.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * The global login check: every route not marked public needs a valid
 * session JWT, else it is answered with 401 `unauthenticated`. The verified
 * parent is put on the request for the handlers. A login with less than half
 * its lifetime left is renewed on the response, and the ID token cookie with
 * it, so the two keep lasting as long as each other.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const now = new Date();
    const session = await this.tokens.verifySession(readCookie(request, SESSION_COOKIE), now);
    if (session === undefined) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    setCurrentParentId(request, session.parentId);

    if (needsRenewal(session.expiresAt, now)) {
      setSessionCookies(
        http.getResponse<Response>(),
        await this.tokens.issueSession(session.parentId, now),
        readCookie(request, ID_TOKEN_COOKIE),
      );
    }
    return true;
  }
}
