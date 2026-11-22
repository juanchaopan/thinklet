import { Injectable, Logger } from '@nestjs/common';
import {
  calculatePKCECodeChallenge,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { describeError } from '../../infrastructure/logging/describe-error.js';
import { FamilyService } from '../family/family.service.js';
import { OidcService } from './oidc.service.js';
import { safeReturnTo } from './return-to.js';
import { SessionTokensService } from './session-tokens.service.js';

/** Where a login that did not succeed returns: the home page, which shows "登录没有成功". */
export const LOGIN_FAILED_PATH = '/?login=failed';

/** A login sent on to the identity provider, or one that could not start. */
export type LoginStart =
  { ok: true; authorizationUrl: string; loginTransactionToken: string } | { ok: false };

/** A login the parent came back from: signed in, or not. */
export type LoginCompletion =
  { ok: true; sessionToken: string; idToken: string; returnTo: string } | { ok: false };

class LoginTransactionError extends Error {
  override readonly name = 'LoginTransactionError';

  constructor() {
    super('The login cookie is missing, expired or not valid');
  }
}

/**
 * The login flow (`.docs/design/rules.md`, "登录和登录状态"): sends the
 * parent to the identity provider with a fresh state, nonce and PKCE
 * verifier, and on their return records the login and issues the session.
 * A step that fails is logged by its error's safe description only, never
 * with the parent's data or a token, and the parent returns to the home
 * page.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly tokens: SessionTokensService,
    private readonly family: FamilyService,
  ) {}

  /** Starts a login that returns to `returnTo` when it is a page of this site, else to `/`. */
  async startLogin(returnTo: unknown): Promise<LoginStart> {
    const transaction = {
      state: randomState(),
      nonce: randomNonce(),
      codeVerifier: randomPKCECodeVerifier(),
      returnTo: safeReturnTo(returnTo),
    };
    try {
      const authorizationUrl = await this.oidc.authorizationUrl({
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge: await calculatePKCECodeChallenge(transaction.codeVerifier),
      });
      const loginTransactionToken = await this.tokens.issueLoginTransaction(transaction);
      return { ok: true, authorizationUrl, loginTransactionToken };
    } catch (error) {
      this.logger.warn({ error: describeError(error) }, 'Login could not start');
      return { ok: false };
    }
  }

  /**
   * Completes the login the transaction token belongs to with the callback's
   * query: checks it, records the parent's login and issues their session.
   */
  async completeLogin(
    loginTransactionToken: string | undefined,
    callbackQuery: string,
  ): Promise<LoginCompletion> {
    try {
      const transaction = await this.tokens.verifyLoginTransaction(loginTransactionToken);
      if (transaction === undefined) {
        throw new LoginTransactionError();
      }
      const { idToken, claims } = await this.oidc.completeLogin(callbackQuery, transaction);
      const parentId = await this.family.recordLogin(claims.iss, claims.sub, claims);
      const sessionToken = await this.tokens.issueSession(parentId);
      return { ok: true, sessionToken, idToken, returnTo: transaction.returnTo };
    } catch (error) {
      this.logger.warn({ error: describeError(error) }, 'Login failed');
      return { ok: false };
    }
  }

  /** The identity provider's logout address for the login the ID token belongs to, if any. */
  endSessionUrl(idToken: string | undefined): Promise<string> {
    return this.oidc.endSessionUrl(idToken);
  }
}
