import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_CHILD_ROUTE } from '../../infrastructure/authentication/child-route.decorator.js';
import { IS_PARENT_OR_CHILD_ROUTE } from '../../infrastructure/authentication/parent-or-child-route.decorator.js';
import { IS_PUBLIC } from '../../infrastructure/authentication/public.decorator.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { ParentSessionService } from './parent-session.service.js';

/** The marks of routes whose login check is not the parent's alone. */
const ROUTES_WITH_OWN_CHECK = [IS_PUBLIC, IS_CHILD_ROUTE, IS_PARENT_OR_CHILD_ROUTE];

/**
 * The global login check. A route marked public needs no login. A route
 * marked as a child route is left to the child's login check, and one
 * marked for a parent or a child to its own guard, which accepts either
 * login. Every other route is a parent's: it needs a valid session JWT of
 * kind `parent` in the parent's cookie (ParentSessionService), else it is
 * answered with 401 `unauthenticated`, so a child's JWT opens no parent
 * route in either cookie.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly parentSessions: ParentSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (ROUTES_WITH_OWN_CHECK.some((key) => this.isMarked(key, context))) {
      return true;
    }

    const http = context.switchToHttp();
    const signedIn = await this.parentSessions.authenticate(
      http.getRequest<Request>(),
      http.getResponse<Response>(),
    );
    if (!signedIn) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
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
