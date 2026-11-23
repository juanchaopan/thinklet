import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CHILD_LOGIN_PATH, ChildSession } from '../../core/child-session';
import { whenBackInFront } from '../../core/connectivity';
import { showSomethingWentWrong } from '../../core/failures';
import { PublicLayout } from '../../core/layout/public-layout';
import { Art, Logo } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { PageProblem } from '../../shared/ui/page-problem';
import { Toaster } from '../../shared/ui/toast';
import { WelcomeBanner } from '../../shared/ui/welcome-banner';

/**
 * The signed-in child's home page (rules.md, 孩子首页), at `/child/home` and
 * at `/` when only a child is signed in. A light top bar holds the full logo
 * and, at the right, the child's avatar and nickname and 退出, which signs
 * the child out (the children this device remembers stay) and opens the
 * child login. Under it the rabbit teacher's welcome banner greets the child
 * without an entrance, and a card says the books the parents assign will
 * show here; it rises into place.
 *
 * The child is asked about again whenever the window comes back to the
 * front, so a child deleted or whose password was reset meanwhile goes to
 * the child login. When the child cannot be loaded at all, the page says it
 * did not open, with a retry.
 */
@Component({
  selector: 'app-child-home',
  imports: [Art, Avatar, Button, Card, Logo, PageProblem, PublicLayout, WelcomeBanner],
  template: `
    @if (child(); as child) {
      <div class="flex min-h-screen flex-col">
        <header
          class="flex h-20 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:h-24 sm:px-8"
        >
          <app-logo [height]="56" />
          <div class="ml-auto flex items-center gap-2 sm:gap-4">
            <span class="flex items-center gap-2">
              <app-avatar [name]="child.nickname" [personId]="child.id" size="bar" />
              <span class="text-lg font-black">{{ child.nickname }}</span>
            </span>
            <button type="button" appButton="secondary" [disabled]="leaving()" (click)="logout()">
              <img alt="" appArt="door" class="size-6" />退出
            </button>
          </div>
        </header>
        <main class="flex-1 px-4 py-6 sm:px-8 sm:py-10">
          <div class="mx-auto flex max-w-5xl flex-col gap-6">
            <app-welcome-banner [greeting]="greeting()" [large]="true" />
            <section appCard class="animate-rise [animation-delay:40ms]">
              <div class="flex flex-col items-center gap-3 py-8 text-center">
                <img alt="" appArt="seedling" class="size-20" />
                <h2 class="text-2xl font-black">还没有书</h2>
                <p class="text-lg text-ink-soft">家长给你分派书以后，会出现在这里。</p>
              </div>
            </section>
          </div>
        </main>
      </div>
    } @else if (childSession.status() === 'failed') {
      <app-public-layout>
        <div class="px-5 sm:px-8">
          <app-page-problem
            kind="server"
            [requestId]="childSession.failure()?.requestId"
            (action)="retry()"
          />
        </div>
      </app-public-layout>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildHome {
  protected readonly childSession = inject(ChildSession);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);

  protected readonly child = this.childSession.child;
  protected readonly greeting = computed(() => `你好，${this.child()?.nickname ?? ''}！`);
  /** 退出 is on its way. */
  protected readonly leaving = signal(false);

  constructor() {
    whenBackInFront(() => void this.childSession.refresh());
  }

  protected async logout(): Promise<void> {
    if (this.leaving()) {
      return;
    }
    this.leaving.set(true);
    try {
      await this.childSession.logout();
    } catch {
      showSomethingWentWrong(this.toaster);
    } finally {
      this.leaving.set(false);
    }
  }

  protected async retry(): Promise<void> {
    if ((await this.childSession.ensureLoaded()) === 'signed-out') {
      await this.router.navigateByUrl(CHILD_LOGIN_PATH);
    }
  }
}
