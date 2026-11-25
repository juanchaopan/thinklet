import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  childLoginAnswerSchema,
  childLoginLinkInfoSchema,
  childLoginResponseSchema,
  rememberedChildListSchema,
  type ChildLinkLoginRequest,
  type ChildLoginLinkInfo,
  type ChildLoginRequest,
  type ChildLoginResponse,
  type ChildNeedsPassword,
  type RememberedChild,
  type SetChildPasswordRequest,
  type SetChildPasswordWithAccountRequest,
} from '@thinklet/contracts';
import { Api } from '../../core/api';
import { CHILD_HOME_PATH, ChildSession } from '../../core/child-session';

/**
 * The ways a child signs in (interfaces.md, 孩子登录): with the family code,
 * the account and the password, setting the first password there when the
 * login says the child has none yet; by tapping a child this browser
 * remembers; and with a login link from a parent's QR code, setting the
 * first password or typing the one the child has. A login that succeeds
 * signs the child in on this browser, in place of any child signed in
 * before, and opens the child's home page. A failure is thrown as the api's
 * ApiError, whose code the page explains.
 */
@Injectable({ providedIn: 'root' })
export class ChildEntry {
  private readonly api = inject(Api);
  private readonly childSession = inject(ChildSession);
  private readonly router = inject(Router);

  /** The children this browser remembers; none without a device cookie. */
  remembered(): Promise<RememberedChild[]> {
    return this.api.get('/api/child-auth/remembered', rememberedChildListSchema);
  }

  /**
   * Logs in with the family code and the account, and the password when one
   * was typed. Returns the child who has to set a password first, signing
   * nobody in; null once the child is signed in and home.
   */
  async login(request: ChildLoginRequest): Promise<ChildNeedsPassword | null> {
    const answer = await this.api.send(
      'POST',
      '/api/child-auth/login',
      request,
      childLoginAnswerSchema,
    );
    if ('needsPassword' in answer) {
      return answer;
    }
    await this.signIn(answer);
    return null;
  }

  /** Sets the first password of the child the family code and the account find, which signs the child in. */
  setFirstPassword(request: SetChildPasswordWithAccountRequest): Promise<void> {
    return this.enter('/api/child-auth/password', request);
  }

  loginRemembered(childId: string): Promise<void> {
    return this.enter(`/api/child-auth/remembered/${encodeURIComponent(childId)}/login`);
  }

  /** Whose login link it is and whether the child still has to set a password; reading it does not use it. */
  link(token: string): Promise<ChildLoginLinkInfo> {
    return this.api.get(linkPath(token), childLoginLinkInfoSchema);
  }

  setPassword(token: string, request: SetChildPasswordRequest): Promise<void> {
    return this.enter(`${linkPath(token)}/password`, request);
  }

  loginByLink(token: string, request: ChildLinkLoginRequest): Promise<void> {
    return this.enter(`${linkPath(token)}/login`, request);
  }

  /** Sends one of the logins that sign the child in, then signs the child in. */
  private async enter(path: string, request?: object): Promise<void> {
    await this.signIn(await this.api.send('POST', path, request, childLoginResponseSchema));
  }

  /** Signs the child a login answered with in and opens the child's home page. */
  private async signIn(child: ChildLoginResponse): Promise<void> {
    this.childSession.signIn(child);
    await this.router.navigateByUrl(CHILD_HOME_PATH, { replaceUrl: true });
  }
}

function linkPath(token: string): string {
  return `/api/child-login-links/${encodeURIComponent(token)}`;
}
