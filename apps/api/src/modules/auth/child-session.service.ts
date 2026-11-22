import { HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { setCurrentChildId } from '../../infrastructure/authentication/current-child.js';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import {
  CHILD_SESSION_COOKIE,
  clearChildSessionCookie,
  readCookie,
  setChildSessionCookie,
} from './session-cookies.js';
import { needsRenewal } from './session-lifetime.js';
import { SessionTokensService } from './session-tokens.service.js';

/** A verified child login. */
export interface ChildSession {
  childId: string;
  /**
   * When the login was issued, in whole seconds as the JWT carries it. A
   * time it is compared with (such as the last password reset) has to be
   * cut to whole seconds too, or a login issued in the same second as that
   * time would read as older.
   */
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * The child's login state, for the child module (decision 0033): a session
 * JWT of kind `child` in the child's own cookie, with the same lifetime and
 * renewal as the parent's and signed with the same key. A child login never
 * touches the parent's cookies, so a parent and a child can both be signed
 * in on one browser.
 */
@Injectable()
export class ChildSessionService {
  constructor(private readonly tokens: SessionTokensService) {}

  /** Signs the child in on the response's browser, in place of any child signed in there. */
  async signIn(response: Response, childId: string, now = new Date()): Promise<void> {
    setChildSessionCookie(response, await this.tokens.issueSession('child', childId, now));
  }

  /** Signs the child out of the response's browser; a parent signed in there stays. */
  signOut(response: Response): void {
    clearChildSessionCookie(response);
  }

  /**
   * The child login of the request's child cookie, or undefined when there
   * is none or its JWT is not a valid `child` one at `now`. It says nothing
   * about whether the child still exists.
   */
  async verify(request: Request, now = new Date()): Promise<ChildSession | undefined> {
    const session = await this.tokens.verifySession(
      readCookie(request, CHILD_SESSION_COOKIE),
      'child',
      now,
    );
    if (session === undefined) {
      return undefined;
    }
    return { childId: session.id, issuedAt: session.issuedAt, expiresAt: session.expiresAt };
  }

  /**
   * The login check of a child route, for the child module's guard to call
   * with its own check of the child (`isCurrent`: the child still exists and
   * the login is newer than the last password reset). A request without a
   * valid child login, or one `isCurrent` refuses, is answered with 401
   * `unauthenticated`. Otherwise the child is recorded on the request for
   * the handlers, and a login with less than 3.5 days left is renewed only
   * then: renewing first would hand a refused login a new issue time and
   * let it outlive a password reset.
   */
  async authenticate(
    request: Request,
    response: Response,
    isCurrent: (session: ChildSession) => Promise<boolean>,
    now = new Date(),
  ): Promise<string> {
    const session = await this.verify(request, now);
    if (session === undefined || !(await isCurrent(session))) {
      throw new ApiError('unauthenticated', HttpStatus.UNAUTHORIZED);
    }
    setCurrentChildId(request, session.childId);
    if (needsRenewal(session.expiresAt, now)) {
      await this.signIn(response, session.childId, now);
    }
    return session.childId;
  }
}
