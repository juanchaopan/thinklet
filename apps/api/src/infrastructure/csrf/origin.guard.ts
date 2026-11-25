import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Environment } from '../config/environment.js';
import { ApiError } from '../errors/api-error.js';
import { SKIPS_ORIGIN_CHECK } from './skip-origin-check.decorator.js';

/** Methods that change no data, so they need no Origin check. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a request may go on: safe methods always; any other method only
 * with an Origin header exactly equal to the site's origin. A missing
 * Origin, `null` and every other value are refused.
 */
export function hasAllowedOrigin(
  method: string,
  origin: string | undefined,
  appOrigin: string,
): boolean {
  return SAFE_METHODS.has(method.toUpperCase()) || origin === appOrigin;
}

/**
 * Global guard against cross-site request forgery, next to the SameSite=Lax
 * cookies: a request that may change data and does not come from the site's
 * own pages is answered with 403 `bad_origin`. It runs before the login
 * check, so a forged request is refused the same way whether or not it
 * carries a login. A route marked with SkipOriginCheck, which another
 * server calls and which proves its caller in its own way, is let through.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly appOrigin: string;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly reflector: Reflector,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const skips = this.reflector.getAllAndOverride<boolean | undefined>(SKIPS_ORIGIN_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skips === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (!hasAllowedOrigin(request.method, request.headers.origin, this.appOrigin)) {
      throw new ApiError('bad_origin', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
