import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { logoutResponseSchema, meResponseSchema, type MeResponse } from '@thinklet/contracts';
import { Api, type ApiError } from './api';
import { asApiError } from './failures';
import { PageNavigation } from './login';

/**
 * Whether a parent is signed in: `unknown` until `/api/me` has answered,
 * `failed` when it could not answer (the server failed or there is no
 * network), so nobody is sent anywhere on a guess.
 */
export type SessionStatus = 'unknown' | 'visitor' | 'signed-in' | 'failed';

/**
 * The signed-in parent (`GET /api/me`) as signals. Any 401 while signed in
 * means the login has expired: the parent goes back to the product home, and
 * signing in again returns to the page they were on.
 */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly page = inject(PageNavigation);

  private readonly current = signal<MeResponse | null>(null);
  private readonly state = signal<SessionStatus>('unknown');
  private readonly problem = signal<ApiError | null>(null);
  private loading: Promise<SessionStatus> | undefined;
  private retryUrl = '/';

  /** The signed-in parent, or null for a visitor. */
  readonly me = this.current.asReadonly();
  readonly status = this.state.asReadonly();
  /** Why the parent could not be loaded, while `status` is `failed`. */
  readonly failure = this.problem.asReadonly();

  constructor() {
    this.api.unauthenticated.subscribe(() => {
      this.expire();
    });
  }

  /** Loads the parent the first time; later calls share that answer. */
  ensureLoaded(): Promise<SessionStatus> {
    this.loading ??= this.load();
    return this.loading;
  }

  /** Remembers the page a navigation was going to when loading failed. */
  keepForRetry(url: string): void {
    this.retryUrl = url;
  }

  /** Asks the api again after a failure, then opens the page that was wanted. */
  async retry(): Promise<void> {
    this.loading = this.load();
    if ((await this.loading) !== 'failed') {
      await this.router.navigateByUrl(this.retryUrl, { onSameUrlNavigation: 'reload' });
    }
  }

  /**
   * Fetches the parent again in the background, so the families and the
   * number of waiting requests stay current. A failure keeps what is shown.
   */
  async refresh(): Promise<void> {
    if (this.state() !== 'signed-in') {
      return;
    }
    try {
      this.current.set(await this.api.get('/api/me', meResponseSchema));
    } catch {
      // A 401 has already sent the parent home; anything else changes nothing.
    }
  }

  /** Replaces the parent with what an api call answered. */
  replace(me: MeResponse): void {
    this.current.set(me);
  }

  /** Signs out here and at the identity provider, which then returns to the product home. */
  async logout(): Promise<void> {
    const { endSessionUrl } = await this.api.send(
      'POST',
      '/api/auth/logout',
      undefined,
      logoutResponseSchema,
    );
    this.page.go(endSessionUrl);
  }

  private async load(): Promise<SessionStatus> {
    try {
      const me = await this.api.get('/api/me', meResponseSchema);
      this.current.set(me);
      this.problem.set(null);
      this.state.set('signed-in');
    } catch (error) {
      const failure = asApiError(error);
      const visitor = failure.code === 'unauthenticated';
      this.current.set(null);
      this.problem.set(visitor ? null : failure);
      this.state.set(visitor ? 'visitor' : 'failed');
    }
    return this.state();
  }

  private expire(): void {
    if (this.state() !== 'signed-in') {
      return;
    }
    const returnTo = this.router.url;
    this.current.set(null);
    this.state.set('visitor');
    this.loading = Promise.resolve('visitor');
    void this.router.navigate(['/'], { queryParams: { returnTo } });
  }
}
