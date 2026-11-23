import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChildLoginLinkInfo } from '@thinklet/contracts';
import { asApiError } from '../../core/failures';
import { FreshReads } from '../../core/fresh-reads';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { PageProblem } from '../../shared/ui/page-problem';
import { ChildColumn } from './child-column';
import { ChildEntry } from './child-entry';
import { PasswordForm, SetPasswordForm } from './qr-forms';

/**
 * What the page shows: nothing while the link is read; the link's form,
 * which sets the first password or asks for the password by what the link
 * says; that the link is no longer valid; or that it could not be read.
 */
type Shown =
  | { readonly kind: 'reading' }
  | { readonly kind: 'form'; readonly link: ChildLoginLinkInfo }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'problem'; readonly requestId: string | undefined };

/**
 * The QR login at `/child/qr/<token>` (rules.md, 扫码登录页), opened from the
 * login QR code a parent shows. Reading the link does not use it; signing in
 * does, and opens the child's home page in place of any child signed in on
 * this browser before. A child without a password sets one; a child with
 * one types it. A link that has expired, was used or replaced, or whose
 * child was deleted, says so under the rabbit teacher and leads to the child
 * login.
 *
 * When the child's password was set or reset meanwhile, the form sent no
 * longer fits: the link is read again and the matching form shown, without a
 * word (interfaces.md, 错误码). A link that cannot be read for a server
 * failure says the page did not open, with a retry.
 */
@Component({
  selector: 'app-child-qr-login',
  imports: [Button, Card, ChildColumn, PageProblem, PasswordForm, RouterLink, SetPasswordForm],
  template: `
    <app-child-column [rabbit]="shown().kind === 'invalid'">
      @switch (shown().kind) {
        @case ('form') {
          @if (link(); as link) {
            @if (link.needsPassword) {
              <app-set-password-form
                [token]="token()"
                [link]="link"
                (stale)="read()"
                (gone)="showInvalid()"
              />
            } @else {
              <app-password-form
                [token]="token()"
                [link]="link"
                (stale)="read()"
                (gone)="showInvalid()"
              />
            }
          }
        }
        @case ('invalid') {
          <section appCard class="relative w-full animate-rise [animation-delay:150ms]">
            <div class="flex flex-col items-center text-center">
              <h1 class="text-2xl font-black">这个二维码已经失效了</h1>
              <p class="mt-2 text-lg text-ink-soft">请家长重新给你一个二维码。</p>
              <a appButton routerLink="/child" class="mt-6 min-h-14! w-full text-lg!">去登录页</a>
            </div>
          </section>
        }
        @case ('problem') {
          <app-page-problem kind="server" [requestId]="requestId()" (action)="read()" />
        }
      }
    </app-child-column>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildQrLogin {
  readonly token = input.required<string>();

  private readonly entry = inject(ChildEntry);
  private readonly reads = new FreshReads();

  protected readonly shown = signal<Shown>({ kind: 'reading' });

  protected readonly link = computed(() => {
    const shown = this.shown();
    return shown.kind === 'form' ? shown.link : null;
  });

  protected readonly requestId = computed(() => {
    const shown = this.shown();
    return shown.kind === 'problem' ? shown.requestId : undefined;
  });

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.read(token));
    });
  }

  protected async read(token = this.token()): Promise<void> {
    const fresh = this.reads.start();
    let shown: Shown;
    try {
      shown = { kind: 'form', link: await this.entry.link(token) };
    } catch (error) {
      const failure = asApiError(error);
      shown =
        failure.code === 'link_invalid'
          ? { kind: 'invalid' }
          : { kind: 'problem', requestId: failure.requestId };
    }
    if (fresh()) {
      this.shown.set(shown);
    }
  }

  protected showInvalid(): void {
    this.reads.wrote();
    this.shown.set({ kind: 'invalid' });
  }
}
