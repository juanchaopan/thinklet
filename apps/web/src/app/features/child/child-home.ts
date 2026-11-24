import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CHILD_LOGIN_PATH, ChildSession } from '../../core/child-session';
import { whenBackInFront } from '../../core/connectivity';
import { showSomethingWentWrong } from '../../core/failures';
import { PublicLayout } from '../../core/layout/public-layout';
import { Art, Logo } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { PageProblem } from '../../shared/ui/page-problem';
import { Toaster } from '../../shared/ui/toast';
import { WelcomeBanner } from '../../shared/ui/welcome-banner';
import { ChildBooks } from './child-books';
import { MyBooks } from './my-books';

/**
 * The signed-in child's home page (rules.md, 孩子首页), at `/child/home` and
 * at `/` when only a child is signed in. A light top bar holds the full logo
 * and, at the right, the child's avatar and nickname and 退出, which signs
 * the child out (the children this device remembers stay) and opens the
 * child login. Under it the rabbit teacher's welcome banner greets the child
 * without an entrance, and 我的书 rises into place once the child's books
 * have come: the books the parents assigned, or 还没有书.
 *
 * The child and the books are asked about again whenever the window comes
 * back to the front, so new books and their count catch up, and a child
 * deleted or whose password was reset meanwhile goes to the child login.
 * When the child cannot be loaded at all, the page says it did not open,
 * with a retry; when the books cannot, the content under the top bar says
 * so, and 退出 stays at hand.
 */
@Component({
  selector: 'app-child-home',
  providers: [ChildBooks],
  imports: [Art, Avatar, Button, Logo, MyBooks, PageProblem, PublicLayout, WelcomeBanner],
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
          @if (books.failure(); as failure) {
            <app-page-problem
              kind="server"
              [requestId]="failure.requestId"
              (action)="books.load()"
            />
          } @else {
            <div class="mx-auto flex max-w-5xl flex-col gap-6">
              <app-welcome-banner [greeting]="greeting()" [large]="true" />
              @if (books.shelf(); as shelf) {
                <app-my-books class="animate-rise [animation-delay:40ms]" [shelf]="shelf" />
              }
            </div>
          }
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
  protected readonly books = inject(ChildBooks);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);

  protected readonly child = this.childSession.child;
  protected readonly greeting = computed(() => `你好，${this.child()?.nickname ?? ''}！`);
  /** 退出 is on its way. */
  protected readonly leaving = signal(false);

  constructor() {
    if (this.childSession.status() === 'signed-in') {
      void this.books.load();
    }
    whenBackInFront(() => {
      void this.childSession.refresh();
      void this.books.refresh();
    });
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

  /** Asks for the child again; once the child is there, the books follow. */
  protected async retry(): Promise<void> {
    const status = await this.childSession.ensureLoaded();
    if (status === 'signed-out') {
      await this.router.navigateByUrl(CHILD_LOGIN_PATH);
    } else if (status === 'signed-in') {
      await this.books.load();
    }
  }
}
