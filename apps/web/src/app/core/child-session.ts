import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { childMeResponseSchema, type ChildMeResponse } from '@thinklet/contracts';
import { Api, type ApiError } from './api';
import { asApiError } from './failures';
import { FreshReads } from './fresh-reads';

/**
 * Whether a child is signed in on this browser: `unknown` until
 * `/api/child/me` has answered, `failed` when it could not answer (the
 * server failed or there is no network).
 */
export type ChildStatus = 'unknown' | 'signed-out' | 'signed-in' | 'failed';

/** The child login page, where a child who is not signed in goes (rules.md, 孩子登录). */
export const CHILD_LOGIN_PATH = '/child';

/** The child's home page, where a child goes once signed in. */
export const CHILD_HOME_PATH = '/child/home';

/**
 * The child signed in on this browser (`GET /api/child/me`) as signals,
 * apart from the parent: a parent and a child can be signed in on the same
 * browser and each signs out alone (rules.md, 孩子登录).
 *
 * The child's api checks on every request that the child is still there and
 * the login is newer than the last password reset; a 401 from it means the
 * login has ended, and the child goes to the child login page.
 */
@Injectable({ providedIn: 'root' })
export class ChildSession {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  private readonly current = signal<ChildMeResponse | null>(null);
  private readonly state = signal<ChildStatus>('unknown');
  private readonly problem = signal<ApiError | null>(null);
  private readonly reads = new FreshReads();
  private loading: Promise<ChildStatus> | undefined;

  /** The signed-in child, or null when no child is signed in. */
  readonly child = this.current.asReadonly();
  readonly status = this.state.asReadonly();
  /** Why the child could not be loaded, while `status` is `failed`. */
  readonly failure = this.problem.asReadonly();

  constructor() {
    this.api.childUnauthenticated.subscribe(() => {
      this.expire();
    });
  }

  /**
   * Loads the child the first time; later calls share that answer. After a
   * failure the next call asks again.
   */
  ensureLoaded(): Promise<ChildStatus> {
    if (!this.loading || this.state() === 'failed') {
      this.loading = this.load();
    }
    return this.loading;
  }

  /**
   * Asks the api again in the background, so a child deleted or whose
   * password was reset meanwhile is sent to the child login. Anything but a
   * 401 keeps what is shown.
   */
  async refresh(): Promise<void> {
    if (this.state() !== 'signed-in') {
      return;
    }
    const fresh = this.reads.start();
    try {
      const child = await this.api.get('/api/child/me', childMeResponseSchema);
      if (fresh()) {
        this.current.set(child);
      }
    } catch {
      // A 401 has already sent the child to the child login.
    }
  }

  /** The child a login answered with, now signed in in place of any child signed in before. */
  signIn(child: ChildMeResponse): void {
    this.show(child, 'signed-in');
  }

  /** Signs the child out and opens the child login; the children this browser remembers stay. */
  async logout(): Promise<void> {
    await this.api.sendWithoutContent('POST', '/api/child-auth/logout');
    this.show(null, 'signed-out');
    await this.router.navigateByUrl(CHILD_LOGIN_PATH);
  }

  private async load(): Promise<ChildStatus> {
    try {
      const child = await this.api.get('/api/child/me', childMeResponseSchema);
      this.show(child, 'signed-in');
    } catch (error) {
      const failure = asApiError(error);
      const signedOut = failure.code === 'unauthenticated';
      this.show(null, signedOut ? 'signed-out' : 'failed');
      this.problem.set(signedOut ? null : failure);
    }
    return this.state();
  }

  /** Shows the child (or none), which is newer than any background read still on its way. */
  private show(child: ChildMeResponse | null, status: ChildStatus): void {
    this.reads.wrote();
    this.current.set(child);
    this.state.set(status);
    this.problem.set(null);
    this.loading = Promise.resolve(status);
  }

  private expire(): void {
    if (this.state() !== 'signed-in') {
      return;
    }
    this.show(null, 'signed-out');
    void this.router.navigateByUrl(CHILD_LOGIN_PATH);
  }
}
