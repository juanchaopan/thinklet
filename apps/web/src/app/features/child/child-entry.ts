import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  childLoginLinkInfoSchema,
  childLoginResponseSchema,
  rememberedChildListSchema,
  type ChildLinkLoginRequest,
  type ChildLoginLinkInfo,
  type ChildLoginRequest,
  type RememberedChild,
  type SetChildPasswordRequest,
} from '@thinklet/contracts';
import { Api } from '../../core/api';
import { CHILD_HOME_PATH, ChildSession } from '../../core/child-session';

/**
 * The ways a child signs in (interfaces.md, 孩子登录): with the family code,
 * the account and the password; by tapping a child this browser remembers;
 * and with a login link from a parent's QR code, setting the first password
 * or typing the one the child has. A login that succeeds signs the child in
 * on this browser, in place of any child signed in before, and opens the
 * child's home page. A failure is thrown as the api's ApiError, whose code
 * the page explains.
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

  login(request: ChildLoginRequest): Promise<void> {
    return this.enter('/api/child-auth/login', request);
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

  /** Sends one of the logins and, once it succeeds, signs the child in and opens the child's home page. */
  private async enter(path: string, request?: object): Promise<void> {
    this.childSession.signIn(await this.api.send('POST', path, request, childLoginResponseSchema));
    await this.router.navigateByUrl(CHILD_HOME_PATH, { replaceUrl: true });
  }
}

function linkPath(token: string): string {
  return `/api/child-login-links/${encodeURIComponent(token)}`;
}
