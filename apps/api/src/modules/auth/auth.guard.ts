import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_CHILD_ROUTE } from '../../infrastructure/authentication/child-route.decorator.js';
import { setCurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { IS_PUBLIC } from '../../infrastructure/authentication/public.decorator.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import {
  ID_TOKEN_COOKIE,
  PARENT_SESSION_COOKIE,
  readCookie,
  setParentSessionCookies,
} from './session-cookies.js';
import { needsRenewal } from './session-lifetime.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * The global login check. A route marked public needs no login. A route
 * marked as a child route is left to the child's login check, which its own
 * guard runs (ChildSessionService.authenticate). Every other route is a
 * parent's: it needs a valid session JWT of kind `parent` in the parent's
 * cookie, else it is answered with 401 `unauthenticated`, so a child's JWT
 * opens no parent route in either cookie. The verified parent is put on the
 * request for the handlers. A login with less than half its lifetime left
 * is renewed on the response, and the ID token cookie with it, so the two
 * keep lasting as long as each other.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isMarked(IS_PUBLIC, context) || this.isMarked(IS_CHILD_ROUTE, context)) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const now = new Date();
    const session = await this.tokens.verifySession(
      readCookie(request, PARENT_SESSION_COOKIE),
      'parent',
      now,
    );
    if (session === undefined) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    setCurrentParentId(request, session.id);

    if (needsRenewal(session.expiresAt, now)) {
      setParentSessionCookies(
        http.getResponse<Response>(),
        await this.tokens.issueSession('parent', session.id, now),
        readCookie(request, ID_TOKEN_COOKIE),
      );
    }
    return true;
  }

  private isMarked(key: string, context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
