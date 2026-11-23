import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RememberedChild } from '@thinklet/contracts';
import { asApiError, showSomethingWentWrong } from '../../core/failures';
import { Avatar } from '../../shared/ui/avatar';
import { Button, PRESS } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Toaster } from '../../shared/ui/toast';
import { ChildColumn } from './child-column';
import { ChildEntry } from './child-entry';
import { ChildLoginForm } from './child-login-form';

/** What the card shows: nothing while the remembered children are read, their avatars, or the form. */
type Shown = 'reading' | 'avatars' | 'form';

/**
 * The child login at `/child` (rules.md, 孩子登录页), under the waving
 * rabbit teacher. On a device that remembers no child it is the form with
 * the family code, the account and the password. On one that remembers
 * children, each is a big avatar with the nickname to tap and sign in
 * without a password, and 用账号登录 opens the form, whose 返回 leads back to
 * the avatars.
 *
 * When the device may no longer sign a child in by the avatar (it was
 * revoked or has expired, or the child's password was reset), that avatar
 * goes away and the form opens filled in with the child's family code and
 * account, saying the password has to be typed again. If the remembered
 * children cannot be read, the form is shown, which signs in all the same.
 */
@Component({
  selector: 'app-child-login',
  imports: [Avatar, Button, Card, ChildColumn, ChildLoginForm, RouterLink],
  template: `
    <app-child-column [rabbit]="shown() !== 'reading'">
      @switch (shown()) {
        @case ('avatars') {
          <section appCard class="relative w-full animate-rise [animation-delay:150ms]">
            <h1 class="text-center text-2xl font-black">点你的头像登录</h1>
            <ul class="mt-6 flex flex-wrap justify-center gap-3 sm:gap-6">
              @for (child of remembered(); track child.childId) {
                <li>
                  <button
                    type="button"
                    class="flex w-36 flex-col items-center gap-3 rounded-3xl p-3 hover:bg-canvas"
                    [class]="press"
                    [disabled]="entering()"
                    (click)="enter(child)"
                  >
                    <app-avatar [name]="child.nickname" [personId]="child.childId" size="pick" />
                    <span class="text-xl font-black">{{ child.nickname }}</span>
                  </button>
                </li>
              }
            </ul>
            <button
              type="button"
              appButton="secondary"
              class="mt-6 min-h-14! w-full text-lg!"
              (click)="useAccount()"
            >
              用账号登录
            </button>
          </section>
          <div class="mt-3"><a appButton="text" routerLink="/" class="text-base!">回到首页</a></div>
        }
        @case ('form') {
          <app-child-login-form
            [relogin]="relogin()"
            [canGoBack]="remembered().length > 0"
            (back)="showAvatars()"
          />
          <div class="mt-3 flex flex-col items-center gap-1 text-center">
            <p class="text-base text-ink-soft">还没有账号？请家长在「孩子」里添加。</p>
            <a appButton="text" routerLink="/" class="text-base!">回到首页</a>
          </div>
        }
      }
    </app-child-column>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildLogin {
  private readonly entry = inject(ChildEntry);
  private readonly toaster = inject(Toaster);

  protected readonly press = PRESS;

  protected readonly shown = signal<Shown>('reading');
  protected readonly remembered = signal<readonly RememberedChild[]>([]);
  /** The remembered child whose device has to type the password again, while the form says so. */
  protected readonly relogin = signal<RememberedChild | null>(null);
  /** A tapped child is being signed in. */
  protected readonly entering = signal(false);

  constructor() {
    void this.read();
  }

  protected useAccount(): void {
    this.relogin.set(null);
    this.shown.set('form');
  }

  protected showAvatars(): void {
    this.relogin.set(null);
    this.shown.set('avatars');
  }

  protected async enter(child: RememberedChild): Promise<void> {
    if (this.entering()) {
      return;
    }
    this.entering.set(true);
    try {
      await this.entry.loginRemembered(child.childId);
    } catch (error) {
      if (asApiError(error).code === 'remember_invalid') {
        this.remembered.update((children) =>
          children.filter((remembered) => remembered.childId !== child.childId),
        );
        this.relogin.set(child);
        this.shown.set('form');
      } else {
        showSomethingWentWrong(this.toaster);
      }
    } finally {
      this.entering.set(false);
    }
  }

  private async read(): Promise<void> {
    let remembered: readonly RememberedChild[] = [];
    try {
      remembered = await this.entry.remembered();
    } catch {
      // Without the remembered children the form still signs a child in.
    }
    this.remembered.set(remembered);
    this.shown.set(remembered.length > 0 ? 'avatars' : 'form');
  }
}
