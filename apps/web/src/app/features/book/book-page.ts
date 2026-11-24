import { ViewportScroller } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { BookDetail } from '@thinklet/contracts';
import { whenBackInFront } from '../../core/connectivity';
import { CurrentFamily } from '../../core/current-family';
import { FamilyTroubleView } from '../../core/family-pages';
import { LibraryAddress } from '../../core/library-address';
import { pageTitle } from '../../core/page-title';
import { Button, PRESS } from '../../shared/ui/button';
import { LineIcon } from '../../shared/ui/line-icon';
import { PageProblem } from '../../shared/ui/page-problem';
import { ReaderAvatars, readersInWords } from '../../shared/ui/reader-avatars';
import { ReadersDialog } from '../../shared/ui/readers-dialog';
import { RemoveBookDialog } from '../../shared/ui/remove-book-dialog';
import { BookObject, CoverGlow } from './book-hero';
import { BookStore } from './book-store';

/** What is open for the book. */
type BookDialog = 'readers' | 'remove';

/** A white pill above the title: the grade or the subject. */
const PILL =
  'rounded-full bg-surface/85 px-3 py-1 text-sm font-bold text-ink-soft ring-1 ring-line';

/** A button that is only text on the page, 44 px high. */
const TEXT_BUTTON = `inline-flex min-h-11 items-center justify-center rounded-full text-sm font-bold hover:bg-canvas ${PRESS}`;

/**
 * One book as the current family sees it, at `/books/<id>` (rules.md, 书本
 * 页; look.md, 书本页). A band as wide as the content area, coloured by the
 * cover, holds 返回, the cover drawn as a book, the grade and subject, the
 * title and the actions: 获取 while the family does not have the book;
 * once it does, ✓ 已获取 with the button that opens 谁能读, showing the
 * readers' avatars and names or the dashed plus and 选择谁能读, or, while
 * the family has no children, 还没有孩子 with 去添加孩子. An inactive book
 * says so above the grade and subject, with a link to the book that
 * replaces it when there is one. What the book is about follows under the
 * band, and 从我家的书里移除 under it while the family has the book and no
 * child reads it, asking first.
 *
 * 返回 leads to the library with the filters it had (core/library-address).
 * A book that does not exist, or that the family cannot see, is 找不到这本书
 * with 回到书库. The browser title is the book's title. The page stays on
 * the book when the parent switches to another family, and shows it as
 * that family sees it; it is read again whenever the window comes back to
 * the front. Acquiring the book and choosing its readers say nothing: the
 * buttons are the answer.
 */
@Component({
  selector: 'app-book-page',
  providers: [BookStore],
  imports: [
    BookObject,
    Button,
    CoverGlow,
    FamilyTroubleView,
    LineIcon,
    PageProblem,
    ReaderAvatars,
    ReadersDialog,
    RemoveBookDialog,
    RouterLink,
  ],
  template: `
    @if (store.trouble(); as trouble) {
      @if (trouble === 'book-not-found') {
        <app-page-problem kind="book-not-found" (action)="toLibrary()" />
      } @else {
        <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
      }
    } @else if (store.book(); as book) {
      <div class="flex stagger flex-col">
        <section
          class="relative -mx-4 -mt-4 px-4 pt-3 pb-14 sm:-mx-6 sm:px-6 sm:pb-16 lg:-mx-10 lg:-mt-20 lg:px-10 lg:pt-10 lg:pb-20"
        >
          <app-cover-glow [coverUrl]="book.coverUrl" />
          <div class="relative mx-auto max-w-5xl">
            <a appButton="text" class="-ml-3 pl-2" routerLink="/" [queryParams]="libraryQuery()">
              <app-line-icon name="back" />返回
            </a>
            <div
              class="mt-4 flex flex-col items-center gap-8 sm:flex-row sm:items-end sm:gap-10 lg:mt-8 lg:gap-14"
            >
              <app-book-object
                class="w-44 shrink-0 sm:w-52 lg:w-64"
                [coverUrl]="book.coverUrl"
                [retired]="book.status === 'inactive'"
              />
              <div
                class="flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:pb-2 sm:text-left"
              >
                @if (book.status === 'inactive') {
                  <p class="mb-5 rounded-2xl bg-sun px-4 py-3 text-sm text-sun-ink">
                    <span>这本书已下架。</span>
                    @if (book.replacement; as replacement) {
                      <span>可以换成</span>
                      <a
                        class="inline-block font-bold underline underline-offset-2"
                        [routerLink]="['/books', replacement.id]"
                        >《{{ replacement.title }}》</a
                      >
                    }
                  </p>
                }
                <div class="flex flex-wrap justify-center gap-2 sm:justify-start">
                  <span class="{{ pill }}">{{ book.grade.name }}</span>
                  <span class="{{ pill }}">{{ book.subject.name }}</span>
                </div>
                <h1 class="mt-4 text-4xl leading-tight font-black tracking-tight sm:text-5xl">
                  {{ book.title }}
                </h1>
                <div class="mt-7 w-full sm:w-auto">
                  @if (book.acquired) {
                    <div class="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
                      <span
                        class="inline-flex min-h-11 items-center gap-1 rounded-full bg-mint px-4 text-sm font-bold whitespace-nowrap text-mint-ink"
                      >
                        <app-line-icon name="tick" />已获取
                      </span>
                      @if (store.children().length > 0) {
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          class="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pr-3 pl-1.5 text-sm font-bold shadow-card hover:bg-canvas {{
                            press
                          }}"
                          (click)="dialog.set('readers')"
                        >
                          <app-reader-avatars [readers]="book.readers" [large]="true" />
                          <span class="min-w-0 truncate">{{ readersText() }}</span>
                          <app-line-icon name="chevron" class="text-ink-muted" />
                        </button>
                      } @else {
                        <span class="flex flex-wrap items-center justify-center gap-x-1">
                          <span class="text-sm text-ink-muted">还没有孩子</span>
                          <a
                            class="px-2 text-ink underline underline-offset-4 {{ textButton }}"
                            [routerLink]="childrenLink()"
                            >去添加孩子</a
                          >
                        </span>
                      }
                    </div>
                  } @else if (book.status === 'active') {
                    <button
                      type="button"
                      appButton
                      class="w-full sm:w-auto sm:min-w-48"
                      [disabled]="store.busy()?.action === 'acquire'"
                      (click)="store.acquire()"
                    >
                      {{ store.busy()?.action === 'acquire' ? '处理中…' : '获取' }}
                    </button>
                  }
                </div>
              </div>
            </div>
          </div>
        </section>
        <section class="mx-auto w-full max-w-5xl">
          <div class="max-w-2xl">
            <h2 class="text-xl font-black">这本书讲什么</h2>
            <p class="mt-3 text-lg leading-loose text-ink-soft">{{ book.intro }}</p>
          </div>
          @if (book.acquired && book.readers.length === 0) {
            <div class="mt-10 flex justify-end border-t border-line pt-4">
              <button
                type="button"
                class="px-4 text-rose-ink {{ textButton }}"
                (click)="dialog.set('remove')"
              >
                从我家的书里移除
              </button>
            </div>
          }
        </section>
      </div>
    }
    @if (dialogBook(); as book) {
      <app-readers-dialog
        [open]="dialog() === 'readers'"
        [title]="book.title"
        [children]="store.children()"
        [readers]="book.readers"
        [retired]="book.status === 'inactive'"
        [busy]="store.busy()?.action === 'readers'"
        (confirmed)="saveReaders($event)"
        (dismissed)="close()"
      />
      <app-remove-book-dialog
        [open]="dialog() === 'remove'"
        [title]="book.title"
        [busy]="store.busy()?.action === 'remove'"
        (confirmed)="remove()"
        (dismissed)="close()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookPage {
  /** The id of the book, from the address. */
  readonly bookId = input.required<string>();

  protected readonly store = inject(BookStore);
  protected readonly press = PRESS;
  protected readonly pill = PILL;
  protected readonly textButton = TEXT_BUTTON;
  private readonly currentFamily = inject(CurrentFamily);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly scroller = inject(ViewportScroller);

  /** The query of the library's address to go back to, with the filters it had. */
  protected readonly libraryQuery = inject(LibraryAddress).query;

  /** The family whose view of the book is shown: the current one. */
  private readonly familyId = computed(() => this.currentFamily.family()?.id ?? null);

  protected readonly childrenLink = computed(() => `/families/${this.familyId() ?? ''}/children`);

  /** What is open now for the book. */
  protected readonly dialog = signal<BookDialog | null>(null);

  /**
   * The book the dialogs are about: the book shown, or the one shown last,
   * so a dialog keeps its words while it leaves.
   */
  protected readonly dialogBook = linkedSignal<BookDetail | null, BookDetail | null>({
    source: this.store.book,
    computation: (book, previous) => book ?? previous?.value ?? null,
  });

  /** Who reads the book, in words, as its 谁能读 button says it. */
  protected readonly readersText = computed(() =>
    readersInWords(this.store.book()?.readers ?? [], '选择谁能读'),
  );

  constructor() {
    let bookShown: string | null = null;
    effect(() => {
      const familyId = this.familyId();
      const bookId = this.bookId();
      untracked(() => {
        if (familyId === null) {
          return;
        }
        if (bookId !== bookShown) {
          bookShown = bookId;
          this.scroller.scrollToPosition([0, 0]);
        }
        this.close();
        void this.store.open(familyId, bookId);
      });
    });
    effect(() => {
      const book = this.store.book();
      const trouble = this.store.trouble();
      if (book) {
        this.title.setTitle(pageTitle(book.title));
      } else if (trouble === 'book-not-found') {
        this.title.setTitle(pageTitle('找不到这本书'));
      }
    });
    whenBackInFront(() => void this.store.load());
  }

  /** 回到书库: the library, with the filters it had. */
  protected toLibrary(): void {
    void this.router.navigate(['/'], { queryParams: this.libraryQuery() });
  }

  protected close(): void {
    this.dialog.set(null);
  }

  /** Saves who reads the book; a choice that failed stays open to try again. */
  protected async saveReaders(childIds: readonly string[]): Promise<void> {
    if ((await this.store.setReaders(childIds)) !== 'failed') {
      this.close();
    }
  }

  /** Removes the book once confirmed; the question closes whatever the outcome. */
  protected async remove(): Promise<void> {
    await this.store.remove();
    this.close();
  }
}
