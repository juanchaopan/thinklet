import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readCookie } from '../../infrastructure/authentication/cookies.js';
import { setCurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import {
  clearAllParentCookies,
  ID_TOKEN_COOKIE,
  PARENT_SESSION_COOKIE,
  setParentSessionCookies,
} from './session-cookies.js';
import { needsRenewal } from './session-lifetime.js';
import { SessionTokensService } from './session-tokens.service.js';

/**
 * The parent's login state on a request: a session JWT of kind `parent` in
 * the parent's cookie. The global login check uses it on every parent
 * route; other modules use it on routes that a signed-in child may use as
 * well, which the global check leaves to them, and to end the login of a
 * parent whose account they deleted.
 */
@Injectable()
export class ParentSessionService {
  constructor(private readonly tokens: SessionTokensService) {}

  /**
   * Whether the request carries a valid parent login at `now`. Only the
   * parent's cookie is read, as a `parent` JWT, so a child's JWT is no
   * parent login in either cookie. A valid login is recorded on the
   * request for the handlers, and one with less than half its lifetime
   * left is renewed on the response with the ID token cookie, so the two
   * keep lasting as long as each other.
   */
  async authenticate(request: Request, response: Response, now = new Date()): Promise<boolean> {
    const session = await this.tokens.verifySession(
      readCookie(request, PARENT_SESSION_COOKIE),
      'parent',
      now,
    );
    if (session === undefined) {
      return false;
    }
    setCurrentParentId(request, session.id);

    if (needsRenewal(session.expiresAt, now)) {
      setParentSessionCookies(
        response,
        await this.tokens.issueSession('parent', session.id, now),
        readCookie(request, ID_TOKEN_COOKIE),
      );
    }
    return true;
  }

  /**
   * Ends the parent's login on this browser for good, as deleting the
   * account does: every cookie of the parent's is cleared, the renewal the
   * login check may have set on this response included, since a cleared
   * cookie set later on the response wins. A child's login stays.
   */
  end(response: Response): void {
    clearAllParentCookies(response);
  }
}
