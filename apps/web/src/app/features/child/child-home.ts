import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChildSession } from '../../core/child-session';
import { whenBackInFront } from '../../core/connectivity';
import { PublicLayout } from '../../core/layout/public-layout';
import { PageProblem } from '../../shared/ui/page-problem';
import { WelcomeBanner } from '../../shared/ui/welcome-banner';
import { ChildBooks } from './child-books';
import { ChildTopBar } from './child-top-bar';
import { MyBooks } from './my-books';

/**
 * The signed-in child's home page (rules.md, 孩子首页), at `/child/home` and
 * at `/` when only a child is signed in. The child's top bar holds the full
 * logo and the child's avatar, which opens the child's own settings, where
 * the child signs out. Under it the rabbit teacher's welcome banner greets
 * the child without an entrance, and 我的书 rises into place once the
 * child's books have come: the books the parents assigned, or 还没有书.
 *
 * The child and the books are asked about again whenever the window comes
 * back to the front, so new books and their count catch up, and a child
 * deleted or whose password was reset meanwhile goes to the child login.
 * When the child cannot be loaded at all, the page says it did not open,
 * with a retry; when the books cannot, the content under the top bar says
 * so, and the way to the settings stays at hand.
 */
@Component({
  selector: 'app-child-home',
  providers: [ChildBooks],
  imports: [ChildTopBar, MyBooks, PageProblem, PublicLayout, WelcomeBanner],
  template: `
    @if (child(); as child) {
      <div class="flex min-h-screen flex-col">
        <app-child-top-bar [child]="child" />
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

  protected readonly child = this.childSession.child;
  protected readonly greeting = computed(() => `你好，${this.child()?.nickname ?? ''}！`);

  constructor() {
    if (this.childSession.status() === 'signed-in') {
      void this.books.load();
    }
    whenBackInFront(() => {
      void this.childSession.refresh();
      void this.books.refresh();
    });
  }

  /** Asks for the child again; once the child is there, the books follow. */
  protected async retry(): Promise<void> {
    if (await this.childSession.retry()) {
      await this.books.load();
    }
  }
}
