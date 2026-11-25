import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { BookCard } from '@thinklet/contracts';
import { whenBackInFront } from '../../core/connectivity';
import { CurrentFamily } from '../../core/current-family';
import { FamilyTroubleView } from '../../core/family-pages';
import { LibraryAddress } from '../../core/library-address';
import { LoginFailedDialog } from '../../core/login-failed-dialog';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { BookGrid } from '../../shared/ui/book-tile';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { InputMode } from '../../shared/ui/input-mode';
import { ReadersDialog } from '../../shared/ui/readers-dialog';
import { RemoveBookDialog } from '../../shared/ui/remove-book-dialog';
import { WelcomeBanner } from '../../shared/ui/welcome-banner';
import { InView } from './in-view';
import { LibraryCard } from './library-card';
import { LibraryFilters, type ScopeChoice } from './library-filters';
import {
  WHOLE_LIBRARY,
  addressOf,
  queryFromAddress,
  sameQuery,
  toggled,
  withKnownChild,
  withinOptions,
  type LibraryQuery,
} from './library-query';
import { LibraryStore } from './library-store';

/** What is open for a book. */
type BookDialog = 'readers' | 'remove';

/** The time between two cards rising one after another, in ms (look.md, 动画). */
const RISE_STEP = 40;

/**
 * The current family's library at `/` (rules.md, 书库): the rabbit
 * teacher's low welcome banner, the three filters and the books they let
 * through, newest first. The filters are kept in the address, so a reload
 * or coming back from a book shows the same books; a grade or subject
 * pressed applies at once. Without books it says 没有符合条件的书 with
 * 清除筛选, which takes every filter back to the whole library. The filters
 * shown are also remembered for 返回 on a book page (core/library-address).
 *
 * Books come 12 at a time: with a mouse 加载更多 brings the next ones, on a
 * touch screen they come as the end of the list scrolls into view; once
 * every book is shown the page says 全部的书都在这里了. When a batch fails
 * on a touch screen, the next swipe tries it once more, even with the end
 * of the list still in view (rules.md, 出错, 加载更多失败); each try needs a
 * swipe of its own, so a server that keeps failing is not asked again and
 * again. A card opens 谁能读 from its avatars, and asks before it removes a
 * book from the family's books.
 *
 * A signed-in parent whose sign-in again failed lands on `/?login=failed`,
 * which is this page: 登录没有成功 covers it (rules.md, 登录和登录状态).
 *
 * The page opens with its parts rising one after another and the rabbit
 * rising 120 ms after its banner; a new batch, and the books of new filters,
 * rise card by card (look.md, 动画). Everything is read again whenever the
 * window comes back to the front, and when the parent switches to another
 * family.
 *
 * The grid and the marker at the end of the list are each drawn in a
 * one-item `@for` tracked by a key: a new key draws them anew, so the books
 * of new filters rise from the start and a new marker says at once whether
 * it is in view, while the same key keeps them as they are.
 */
@Component({
  selector: 'app-library-page',
  providers: [LibraryStore],
  imports: [
    Art,
    BookGrid,
    Button,
    Card,
    FamilyTroubleView,
    InView,
    LibraryCard,
    LibraryFilters,
    LoginFailedDialog,
    ReadersDialog,
    RemoveBookDialog,
    WelcomeBanner,
  ],
  host: { '(document:touchmove)': 'swiped()' },
  template: `
    @if (store.trouble(); as trouble) {
      <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
    } @else if (store.listing(); as listing) {
      <div class="mx-auto flex w-full max-w-5xl stagger flex-col gap-5">
        <app-welcome-banner [greeting]="greeting()" line="挑几本书，分派给孩子吧。" />
        <app-library-filters
          [query]="shown() ?? listing.query"
          [options]="listing.options"
          [children]="store.children() ?? []"
          (grades)="pickGrade($event)"
          (subjects)="pickSubject($event)"
          (scope)="pickScope($event)"
        />
        @if (listing.books.length > 0) {
          <div class="relative">
            @for (grid of [{ key: listing.key }]; track grid.key) {
              <app-book-grid>
                @for (book of listing.books; track book.id; let index = $index) {
                  <app-library-card
                    [book]="book"
                    [acquiring]="store.busy()?.bookId === book.id"
                    [class.animate-rise]="riseDelay(index) !== null"
                    [style.animation-delay.ms]="riseDelay(index)"
                    (acquire)="store.acquire(book)"
                    (readers)="ask('readers', book)"
                    (remove)="ask('remove', book)"
                  />
                }
              </app-book-grid>
            }
            @if (listing.nextCursor && inputMode.touch()) {
              @for (end of [{ key: listing.nextCursor + '#' + endWatches() }]; track end.key) {
                <div
                  appInView
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-x-0 bottom-0 h-px"
                  (inView)="endInView($event)"
                ></div>
              }
            }
          </div>
          @if (!listing.nextCursor) {
            <p class="py-2 text-center text-sm text-ink-muted">全部的书都在这里了</p>
          } @else if (!inputMode.touch()) {
            <div class="flex justify-center">
              <button
                type="button"
                appButton="secondary"
                class="min-w-48"
                [disabled]="store.loadingMore()"
                (click)="store.loadMore()"
              >
                {{ store.loadingMore() ? '加载中…' : '加载更多' }}
              </button>
            </div>
          }
        } @else {
          <section appCard>
            <div class="flex flex-col items-center gap-2 py-8 text-center">
              <img alt="" appArt="seedling" class="size-16" />
              <h2 class="mt-2 text-lg font-black">没有符合条件的书</h2>
              <button type="button" appButton class="mt-4" (click)="clearFilters()">
                清除筛选
              </button>
            </div>
          </section>
        }
      </div>
    }
    @if (asked(); as book) {
      <app-readers-dialog
        [open]="dialog() === 'readers'"
        [title]="book.title"
        [children]="store.children() ?? []"
        [readers]="book.readers"
        [retired]="book.status === 'inactive'"
        [busy]="store.busy()?.action === 'readers'"
        (confirmed)="saveReaders(book, $event)"
        (dismissed)="close()"
      />
      <app-remove-book-dialog
        [open]="dialog() === 'remove'"
        [title]="book.title"
        [busy]="store.busy()?.action === 'remove'"
        (confirmed)="remove(book)"
        (dismissed)="close()"
      />
    }
    <app-login-failed-dialog />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage {
  protected readonly store = inject(LibraryStore);
  protected readonly inputMode = inject(InputMode);
  private readonly session = inject(Session);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly router = inject(Router);
  private readonly libraryAddress = inject(LibraryAddress);
  private readonly address = toSignal(inject(ActivatedRoute).queryParamMap, {
    requireSync: true,
  });

  /** The family whose library is shown: the current one. */
  private readonly familyId = computed(() => this.currentFamily.family()?.id ?? null);

  /** What the address asks the library to show. */
  private readonly wanted = computed(() => queryFromAddress(this.address()), {
    equal: sameQuery,
  });

  protected readonly greeting = computed(() => `欢迎回来，${this.session.me()?.name ?? ''}`);

  /**
   * What the filters say they let through: the address's query as the
   * family's children and the filter options take it. It follows the
   * address at once, before the books it asks for have come.
   */
  protected readonly shown = computed(() => {
    const listing = this.store.listing();
    if (!listing) {
      return null;
    }
    const childIds = (this.store.children() ?? []).map(({ id }) => id);
    return withinOptions(withKnownChild(this.wanted(), childIds), listing.options);
  });

  /** What is open now for the book asked about. */
  protected readonly dialog = signal<BookDialog | null>(null);
  /** The book last asked about, as it was then. */
  private readonly askedBook = signal<BookCard | null>(null);
  /**
   * The book last asked about, as the list shows it now. It stays after the
   * dialog closes, so the dialog keeps its words while it leaves.
   */
  protected readonly asked = computed(() => {
    const book = this.askedBook();
    return this.store.listing()?.books.find(({ id }) => id === book?.id) ?? book;
  });

  /**
   * How many times the end of the list has been watched afresh. The marker
   * at the end is drawn anew for each count, and a new marker says at once
   * whether it is in view.
   */
  protected readonly endWatches = signal(0);
  /** Whether the batch the end of the list asked for failed, so the next swipe tries again. */
  private retryOnSwipe = false;

  constructor() {
    let familyShown: string | null = null;
    effect(() => {
      const familyId = this.familyId();
      const wanted = this.wanted();
      untracked(() => {
        if (familyId === null) {
          return;
        }
        if (familyId === familyShown) {
          void this.store.show(wanted);
          return;
        }
        familyShown = familyId;
        this.close();
        void this.store.open(familyId, wanted);
      });
    });
    effect(() => {
      this.libraryAddress.remember(addressOf(this.wanted()));
    });
    whenBackInFront(() => void this.store.refresh());
  }

  /**
   * How long the card at `index` waits to rise, after the cards before it in
   * its batch; null for a card that does not rise as it comes in.
   */
  protected riseDelay(index: number): number | null {
    const from = this.store.listing()?.risingFrom ?? null;
    return from !== null && index >= from ? (index - from) * RISE_STEP : null;
  }

  /** The end of the list came into view on a touch screen: the next batch comes. */
  protected endInView(visible: boolean): void {
    if (visible) {
      void this.loadAtEnd();
    }
  }

  /**
   * A finger moved on the screen. After a failed batch the end of the list
   * is watched afresh, which tries the batch again when it is in view.
   */
  protected swiped(): void {
    if (this.retryOnSwipe) {
      this.retryOnSwipe = false;
      this.endWatches.update((count) => count + 1);
    }
  }

  protected pickGrade(gradeId: string | null): void {
    const shown = this.shown();
    if (!shown) {
      return;
    }
    const options = this.store.listing()?.options.grades ?? [];
    const grades = gradeId === null ? [] : toggled(shown.grades, gradeId, options);
    this.go({ ...this.wanted(), grades, scope: shown.scope, child: shown.child });
  }

  protected pickSubject(subjectId: string | null): void {
    const shown = this.shown();
    if (!shown) {
      return;
    }
    const options = this.store.listing()?.options.subjects ?? [];
    const subjects = subjectId === null ? [] : toggled(shown.subjects, subjectId, options);
    this.go({ ...shown, subjects });
  }

  protected pickScope({ scope, child }: ScopeChoice): void {
    this.go({ ...this.wanted(), scope, child });
  }

  protected clearFilters(): void {
    this.go(WHOLE_LIBRARY);
  }

  protected ask(dialog: BookDialog, book: BookCard): void {
    this.askedBook.set(book);
    this.dialog.set(dialog);
  }

  protected close(): void {
    this.dialog.set(null);
  }

  /** Saves who reads the book; a choice that failed stays open to try again. */
  protected async saveReaders(book: BookCard, childIds: readonly string[]): Promise<void> {
    if ((await this.store.setReaders(book, childIds)) !== 'failed') {
      this.close();
    }
  }

  /** Removes the book once confirmed; the question closes whatever the outcome. */
  protected async remove(book: BookCard): Promise<void> {
    await this.store.remove(book);
    this.close();
  }

  /** Loads the next batch for the end of the list; a failure waits for the next swipe. */
  private async loadAtEnd(): Promise<void> {
    this.retryOnSwipe = false;
    if (!(await this.store.loadMore())) {
      this.retryOnSwipe = true;
    }
  }

  /** Shows the query, kept in the address in place of the one there. */
  private go(query: LibraryQuery): void {
    void this.router.navigate(['/'], { queryParams: addressOf(query), replaceUrl: true });
  }
}
