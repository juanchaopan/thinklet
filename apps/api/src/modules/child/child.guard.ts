import {
  applyDecorators,
  Injectable,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChildRoute } from '../../infrastructure/authentication/child-route.decorator.js';
import { ChildSessionService } from '../auth/child-session.service.js';
import { ChildService } from './child.service.js';

/**
 * The child's login check of the child routes: a valid `child` JWT in the
 * child's cookie (the auth module's half), of a child that still exists,
 * issued since the last password reset (this module's half). Anything else
 * is 401 `unauthenticated`. It records the child on the request for
 * `CurrentChildId`.
 */
@Injectable()
export class ChildGuard implements CanActivate {
  constructor(
    private readonly sessions: ChildSessionService,
    private readonly childService: ChildService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    await this.sessions.authenticate(
      http.getRequest<Request>(),
      http.getResponse<Response>(),
      (session) => this.childService.isCurrent(session),
    );
    return true;
  }
}

/**
 * Marks a controller or a route as one for a signed-in child
 * (`/api/child/*`): the global login check leaves it alone and the child's
 * login check runs instead, so a parent's login opens none of them.
 */
export const ForSignedInChild = (): ClassDecorator & MethodDecorator =>
  applyDecorators(ChildRoute(), UseGuards(ChildGuard));
