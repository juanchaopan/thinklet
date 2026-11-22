import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// The signed-in parent travels on the request from the login check, which
// sets it once the JWT is verified, to the handlers, which read it through
// the decorator. It lives in the infrastructure so every module can read it
// without reaching into the auth module.

const PARENT_ID = Symbol('currentParentId');

type AuthenticatedRequest = Request & { [PARENT_ID]?: string };

/** Records the signed-in parent on the request. */
export function setCurrentParentId(request: Request, parentId: string): void {
  (request as AuthenticatedRequest)[PARENT_ID] = parentId;
}

/**
 * The id of the signed-in parent. Only requests that passed the login check
 * have one, so a route open without a login that reads it is a programming
 * error and fails.
 */
export function currentParentIdOf(request: Request): string {
  const parentId = (request as AuthenticatedRequest)[PARENT_ID];
  if (parentId === undefined) {
    throw new Error('The request has no signed-in parent');
  }
  return parentId;
}

/** Handler parameter decorator for the signed-in parent's id. */
export const CurrentParentId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    currentParentIdOf(context.switchToHttp().getRequest<Request>()),
);
