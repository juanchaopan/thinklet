import {
  applyDecorators,
  Injectable,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ChildRoute } from '../../infrastructure/authentication/child-route.decorator.js';
import {
  IS_PARENT_OR_CHILD_ROUTE,
  ParentOrChildRoute,
} from '../../infrastructure/authentication/parent-or-child-route.decorator.js';
import { ChildSessionService } from '../auth/child-session.service.js';
import { ParentSessionService } from '../auth/parent-session.service.js';
import { ChildService } from '../child/child.service.js';

/**
 * The login check of the book routes that the global check leaves to this
 * module: the signed-in child's books, and the covers, which a signed-in
 * parent may read as well (`.docs/design/rules.md`, "权限"). On a route
 * open to parents, a valid parent login passes. Otherwise the child's
 * login check runs, the same one every child route passes: a valid `child`
 * JWT in the child's cookie (the auth module's half), of a child that
 * still exists, issued since the last password reset (the child module's
 * half). Anything else is 401 `unauthenticated`.
 */
@Injectable()
export class BookReaderGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly parentSessions: ParentSessionService,
    private readonly childSessions: ChildSessionService,
    private readonly childService: ChildService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const opensToParents =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PARENT_OR_CHILD_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (opensToParents && (await this.parentSessions.authenticate(request, response))) {
      return true;
    }
    await this.childSessions.authenticate(request, response, (session) =>
      this.childService.currentAt(session),
    );
    return true;
  }
}

/**
 * Marks a controller or a route of this module as one for a signed-in child
 * (`/api/child/*`): the global login check leaves it alone and the child's
 * login check runs instead, so a parent's login opens none of them.
 */
export const ForSignedInChild = (): ClassDecorator & MethodDecorator =>
  applyDecorators(ChildRoute(), UseGuards(BookReaderGuard));

/** Marks a controller or a route of this module for a signed-in parent or a signed-in child. */
export const ForParentOrChild = (): ClassDecorator & MethodDecorator =>
  applyDecorators(ParentOrChildRoute(), UseGuards(BookReaderGuard));
