import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Environment } from '../config/environment.js';
import { ApiError } from '../errors/api-error.js';

/**
 * The request header Authing's webhook carries its secret in, in Node's
 * lower case. Authing's documentation names two headers; this is the one
 * for the secret set with the webhook. Which one Authing sends is checked
 * with a real notification on staging.
 */
export const AUTHING_WEBHOOK_SECRET_HEADER = 'x-authing-webhook-secret';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Whether the header's value is the secret, compared in constant time: both
 * are hashed first, so the comparison takes as long whatever the value's
 * length and wherever it differs. A missing header, or one sent more than
 * once, never matches.
 */
export function matchesSecret(value: string | string[] | undefined, secret: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return timingSafeEqual(digest(value), digest(secret));
}

/**
 * Lets Authing's webhook through only with AUTHING_WEBHOOK_SECRET in its
 * secret header; anything else is answered with 401 `unauthenticated`
 * before the body is read (`.docs/design/interfaces.md`, "Authing 的通知").
 */
@Injectable()
export class AuthingWebhookGuard implements CanActivate {
  private readonly secret: string;

  constructor(config: ConfigService<Environment, true>) {
    this.secret = config.get('AUTHING_WEBHOOK_SECRET', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!matchesSecret(request.headers[AUTHING_WEBHOOK_SECRET_HEADER], this.secret)) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
