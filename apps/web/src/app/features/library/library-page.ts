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
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { BookGrid } from '../../shared/ui/book-tile';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { InputMode } from '../../shared/ui/input-mode';
import { ReadersDialog } from '../../shared/ui/readers-dialog';
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

/** Whether two lists hold the same ids in the same order. */
function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

/**
 * The current family's library at `/` (rules.md, 书库): the rabbit
 * teacher's low welcome banner, the three filters and the books they let
 * through, newest first. The filters are kept in the address, so a reload
 * or coming back from a book shows the same books; a grade or subject
 * pressed applies at once. Without books it says 没有符合条件的书 with
 * 清除筛选, which takes every filter back to the whole library.
 *
 * Books come 12 at a time: with a mouse 加载更多 brings the next ones, on a
 * touch screen they come as the end of the list scrolls into view; once
 * every book is shown the page says 全部的书都在这里了. A card opens 谁能读
 * from its avatars, and asks before it removes a book from the family's
 * books.
 *
 * The page opens with its parts rising one after another and the rabbit
 * rising 120 ms after its banner; a new batch, and the books of new filters,
 * rise card by card (look.md, 动画). Everything is read again whenever the
 * window comes back to the front, and when the parent switches to another
 * family.
 */
@Component({
  selector: 'app-library-page',
  providers: [LibraryStore],
  imports: [
    Art,
    BookGrid,
    Button,
    Card,
    ConfirmDialog,
    FamilyTroubleView,
    InView,
    LibraryCard,
    LibraryFilters,
    ReadersDialog,
    WelcomeBanner,
  ],
  template: `
    @if (store.trouble(); as trouble) {
      <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
    } @else if (store.listing(); as listing) {
      <div class="mx-auto flex w-full max-w-5xl stagger flex-col gap-5">
        <app-welcome-banner
          [greeting]="greeting()"
          line="挑几本书，分派给孩子吧。"
          [rises]="true"
        />
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
            @for (key of [listing.key]; track key) {
              <app-book-grid>
                @for (book of listing.books; track book.id; let index = $index) {
                  <app-library-card
                    [book]="book"
                    [acquiring]="store.busy()?.bookId === book.id"
                    [class.animate-rise]="rises(index)"
                    [style.animation-delay.ms]="riseDelay(index)"
                    (acquire)="store.acquire(book)"
                    (readers)="ask('readers', book)"
                    (remove)="ask('remove', book)"
                  />
                }
              </app-book-grid>
            }
            @if (listing.nextCursor && inputMode.touch()) {
              @for (cursor of [listing.nextCursor]; track cursor) {
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
        [readers]="askedReaders()"
        [retired]="book.status === 'inactive'"
        [busy]="store.busy()?.action === 'readers'"
        (confirmed)="saveReaders(book, $event)"
        (dismissed)="close()"
      />
      <app-confirm-dialog
        [open]="dialog() === 'remove'"
        icon="door"
        [title]="'从我家的书里移除《' + book.title + '》？'"
        text="这本书还在书库里时，可以再获取。"
        action="移除"
        [danger]="true"
        [busy]="store.busy()?.action === 'remove'"
        (confirmed)="remove(book)"
        (dismissed)="close()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryPage {
  protected readonly store = inject(LibraryStore);
  protected readonly inputMode = inject(InputMode);
  private readonly session = inject(Session);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly router = inject(Router);
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
  protected readonly askedReaders = computed(
    () => this.asked()?.readers.map(({ childId }) => childId) ?? [],
    { equal: sameIds },
  );

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
    whenBackInFront(() => void this.store.refresh());
  }

  /** Whether the card at `index` rises into place as it comes in. */
  protected rises(index: number): boolean {
    const from = this.store.listing()?.risingFrom ?? null;
    return from !== null && index >= from;
  }

  /** How long the card at `index` waits to rise, after the cards before it in its batch. */
  protected riseDelay(index: number): number | null {
    const from = this.store.listing()?.risingFrom ?? null;
    return from !== null && index >= from ? (index - from) * RISE_STEP : null;
  }

  /** The end of the list came into view on a touch screen: the next batch comes. */
  protected endInView(visible: boolean): void {
    if (visible) {
      void this.store.loadMore();
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

  /** Shows the query, kept in the address in place of the one there. */
  private go(query: LibraryQuery): void {
    void this.router.navigate(['/'], { queryParams: addressOf(query), replaceUrl: true });
  }
}
