import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  bookDetailSchema,
  bookFiltersResponseSchema,
  bookListResponseSchema,
  childListSchema,
  type BookCard,
  type BookDetail,
  type BookFiltersResponse,
  type BookListResponse,
  type Child,
  type ErrorCode,
} from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import {
  asApiError,
  explainChange,
  isSignedOut,
  showSomethingWentWrong,
} from '../../core/failures';
import { familyPath, readTrouble, type FamilyTrouble } from '../../core/family-pages';
import { FreshReads } from '../../core/fresh-reads';
import { Session } from '../../core/session';
import { Toaster } from '../../shared/ui/toast';
import { searchOf, withKnownChild, withinOptions, type LibraryQuery } from './library-query';

/**
 * The books on the page, newest first, as far as the batches read so far
 * go, with what they were asked for.
 */
export interface Listing {
  readonly books: readonly BookCard[];
  /** Where the next batch starts; null once every book is shown. */
  readonly nextCursor: string | null;
  /** The query the books answer, as the family and the filter options take it. */
  readonly query: LibraryQuery;
  /** The grades, and the subjects that have books under the grades and scope. */
  readonly options: BookFiltersResponse;
  /** Tells one list of books from the next, so a new list is drawn afresh. */
  readonly key: number;
  /**
   * The first book that rises into place as it came in, the later ones
   * following one after another; null when the books came with the page,
   * which rises as a whole.
   */
  readonly risingFrom: number | null;
}

/** A change to one book; only one runs at a time. */
export type BookAction = 'acquire' | 'readers' | 'remove';

/**
 * How a change ended: `done`; `failed`, said in a toast, with what is on the
 * screen left as it was; or `changed`, the book, a child or the family
 * changed meanwhile, which has been said and the book read again.
 */
export type BookOutcome = 'done' | 'failed' | 'changed';

/**
 * The error codes that mean the family's books or children changed
 * meanwhile (rules.md, 同时操作), with what the toast says.
 */
const CHANGED_MEANWHILE: Partial<Record<ErrorCode, string>> = {
  child_not_found: '这个孩子已经被删除了',
  book_not_acquired: '这本书已经不在我家的书里了',
  book_in_use: '还有孩子在读这本书，先在「谁能读」里取消',
  book_inactive: '这本书已下架',
};

/** How a read of the books goes: a new list, or the list shown read again as far as it goes. */
type ReadMode = 'new' | 'again';

/** What one read of the library found. */
interface ReadResult {
  readonly children: readonly Child[];
  readonly books: readonly BookCard[];
  readonly nextCursor: string | null;
  readonly query: LibraryQuery;
  readonly options: BookFiltersResponse;
}

/** The book as a card shows it. */
function asCard(detail: BookDetail): BookCard {
  const { id, title, intro, grade, subject, status, coverUrl, acquired, readers } = detail;
  return { id, title, intro, grade, subject, status, coverUrl, acquired, readers };
}

/** The address of one of the family's books in the api, with what follows it. */
function bookPath(familyId: string, bookId: string, suffix = ''): string {
  return familyPath(familyId, `/books/${encodeURIComponent(bookId)}${suffix}`);
}

/** The api's address of one batch of the query, from the cursor's position when given. */
function batchPath(familyId: string, query: LibraryQuery, cursor: string | null): string {
  const search = searchOf(query, { subjects: true });
  if (cursor === null) {
    return familyPath(familyId, `/books${search}`);
  }
  const position = `cursor=${encodeURIComponent(cursor)}`;
  return familyPath(familyId, `/books${search ? `${search}&` : '?'}${position}`);
}

/** How many books a read keeps: as many as are shown when the list is read again, else a batch. */
function lengthToKeep(mode: ReadMode, shown: Listing | null): number {
  return mode === 'again' && shown ? shown.books.length : 0;
}

/**
 * The library of the current family at `/` (rules.md, 书库; interfaces.md,
 * 书库和书本（家长）): the family's children, the filter options and the
 * books the filters let through, a batch of 12 at a time; acquiring a book,
 * choosing who reads it and removing it from the family's books.
 *
 * A read shows its answer only when no newer read started and no change was
 * shown meanwhile, so a slow answer never puts back an older list. A batch
 * read for a list that has been replaced meanwhile is dropped.
 *
 * A change the family's books or children went through meanwhile is said in
 * a toast and the book is read again; a family the parent is no longer in
 * makes the parent's families read again, so the page moves to another
 * family, or to the start page without one. The page provides its own
 * instance.
 */
@Injectable()
export class LibraryStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly toaster = inject(Toaster);
  private readonly router = inject(Router);

  private readonly reads = new FreshReads();
  private familyId = '';
  private wanted: LibraryQuery | null = null;
  private nextKey = 0;

  private readonly shownChildren = signal<readonly Child[] | null>(null);
  private readonly shownListing = signal<Listing | null>(null);
  private readonly shownTrouble = signal<FamilyTrouble | null>(null);
  private readonly batchRunning = signal(false);
  private readonly running = signal<{ bookId: string; action: BookAction } | null>(null);

  /** The family's children in the order they were added; null until they have been read. */
  readonly children = this.shownChildren.asReadonly();
  /** The books shown; null until the first batch has been read. */
  readonly listing = this.shownListing.asReadonly();
  /** Why the page shows no books, if it does not. */
  readonly trouble = this.shownTrouble.asReadonly();
  /** Whether the next batch is on its way. */
  readonly loadingMore = this.batchRunning.asReadonly();
  /** The change to a book running now. */
  readonly busy = this.running.asReadonly();

  /** Shows the library of the family with the id for the query, read afresh. */
  async open(familyId: string, query: LibraryQuery): Promise<void> {
    this.familyId = familyId;
    this.wanted = query;
    this.shownChildren.set(null);
    this.shownListing.set(null);
    this.shownTrouble.set(null);
    await this.read('new', true);
  }

  /** Shows the books of another query of the same family. */
  async show(query: LibraryQuery): Promise<void> {
    this.wanted = query;
    await this.read('new', false);
  }

  /** Reads the children and the books afresh, as when the page opens. */
  async load(): Promise<void> {
    await this.read('new', true);
  }

  /**
   * Reads the children and the books shown again, as many batches as are
   * shown, so the list stays as long as it was; nothing rises into place.
   */
  async refresh(): Promise<void> {
    if (this.shownListing()) {
      await this.read('again', true);
    }
  }

  /** Adds the next batch of books to the list; a failure is said in a toast and nothing changes. */
  async loadMore(): Promise<void> {
    const listing = this.shownListing();
    if (!listing?.nextCursor || this.batchRunning()) {
      return;
    }
    this.batchRunning.set(true);
    try {
      const batch = await this.api.get(
        batchPath(this.familyId, listing.query, listing.nextCursor),
        bookListResponseSchema,
      );
      const current = this.shownListing();
      if (current?.key === listing.key && current.nextCursor === listing.nextCursor) {
        this.shownListing.set({
          ...current,
          books: [...current.books, ...batch.books],
          nextCursor: batch.nextCursor,
          risingFrom: current.books.length,
        });
      }
    } catch (error) {
      this.batchFailed(error);
    } finally {
      this.batchRunning.set(false);
    }
  }

  /** Takes the book into the family's books, without a word: the card's footer is the answer. */
  acquire(book: BookCard): Promise<BookOutcome> {
    return this.run(book, 'acquire', async (familyId) => {
      const detail = await this.api.send(
        'PUT',
        bookPath(familyId, book.id, '/acquisition'),
        undefined,
        bookDetailSchema,
      );
      this.update(familyId, detail);
    });
  }

  /** Sets the children who read the book, without a word: the avatars are the answer. */
  setReaders(book: BookCard, childIds: readonly string[]): Promise<BookOutcome> {
    return this.run(book, 'readers', async (familyId) => {
      const detail = await this.api.send(
        'PUT',
        bookPath(familyId, book.id, '/readers'),
        { childIds },
        bookDetailSchema,
      );
      this.update(familyId, detail);
    });
  }

  /**
   * Removes the book from the family's books, saying 已移除《<title>》: its
   * card goes back to a book the family does not have, and an inactive
   * book leaves the list, as only the family's books held it.
   */
  remove(book: BookCard): Promise<BookOutcome> {
    return this.run(book, 'remove', async (familyId) => {
      await this.api.sendWithoutContent('DELETE', bookPath(familyId, book.id, '/acquisition'));
      this.update(familyId, { ...book, acquired: false, readers: [], replacement: null });
      this.toaster.show(`已移除《${book.title}》`, 'success', 'door');
    });
  }

  /**
   * Reads the library for the query asked for last and shows it, unless
   * something newer was shown meanwhile.
   */
  private async read(mode: ReadMode, withChildren: boolean): Promise<void> {
    const wanted = this.wanted;
    if (wanted === null) {
      return;
    }
    const fresh = this.reads.start();
    const shown = this.shownListing();
    try {
      const { children, ...found } = await this.readLibrary(
        this.familyId,
        wanted,
        withChildren,
        lengthToKeep(mode, shown),
      );
      if (fresh()) {
        this.shownChildren.set(children);
        this.shownTrouble.set(null);
        this.shownListing.set(this.listingOf(found, mode, shown));
      }
    } catch (error) {
      if (fresh()) {
        this.readFailed(error, mode, withChildren);
      }
    }
  }

  /**
   * The list a read found, as it replaces the one shown: a new list is drawn
   * afresh and, when it replaces another one, rises card by card; a list
   * read again stays still.
   */
  private listingOf(
    found: Omit<ReadResult, 'children'>,
    mode: ReadMode,
    shown: Listing | null,
  ): Listing {
    if (mode === 'again' && shown) {
      return { ...found, key: shown.key, risingFrom: null };
    }
    return { ...found, key: this.nextKey++, risingFrom: shown ? 0 : null };
  }

  /**
   * The family's children (read again with `withChildren`, or when none
   * have been read yet), the filter options and the batches of the query
   * from the first, until they hold at least `count` books or end. The
   * scope of a child no longer in the family is the library.
   */
  private async readLibrary(
    familyId: string,
    wanted: LibraryQuery,
    withChildren: boolean,
    count: number,
  ): Promise<ReadResult> {
    const known = this.shownChildren();
    const children =
      withChildren || known === null
        ? await this.api.get(familyPath(familyId, '/children'), childListSchema)
        : known;
    const scoped = withKnownChild(
      wanted,
      children.map(({ id }) => id),
    );
    const options = await this.api.get(
      familyPath(familyId, `/book-filters${searchOf(scoped, { subjects: false })}`),
      bookFiltersResponseSchema,
    );
    const query = withinOptions(scoped, options);
    const books: BookCard[] = [];
    let cursor: string | null = null;
    do {
      const batch: BookListResponse = await this.api.get(
        batchPath(familyId, query, cursor),
        bookListResponseSchema,
      );
      books.push(...batch.books);
      cursor = batch.nextCursor;
    } while (cursor !== null && books.length < count);
    return { children, books, nextCursor: cursor, query, options };
  }

  /**
   * A read of the list that failed. A family the parent is not in moves the
   * page on; a child of the scope deleted since the children were read
   * makes them read again, which takes the scope back to the library.
   * Nothing shown yet keeps the failure for the page to show; a new list
   * asked for by the filters says it in a toast and keeps the books shown,
   * and a list read again keeps them without a word.
   */
  private readFailed(error: unknown, mode: ReadMode, withChildren: boolean): void {
    const trouble = readTrouble(error);
    if (trouble === null) {
      return;
    }
    if (trouble === 'not-found') {
      this.notFound();
    } else if (trouble.code === 'child_not_found' && !withChildren) {
      void this.read(mode, true);
    } else if (this.shownListing() === null) {
      this.shownTrouble.set(trouble);
    } else if (mode === 'new') {
      showSomethingWentWrong(this.toaster);
    }
  }

  /** A batch that failed: 出了点问题, unless the parent is signed out or no longer a member. */
  private batchFailed(error: unknown): void {
    if (isSignedOut(error)) {
      return;
    }
    if (asApiError(error).code === 'family_not_found') {
      this.notFound();
      return;
    }
    showSomethingWentWrong(this.toaster);
  }

  /**
   * Runs one change to a book while it is marked busy. Only one runs at a
   * time: while another runs, nothing is done and the answer is `failed`.
   */
  private async run(
    book: BookCard,
    action: BookAction,
    work: (familyId: string) => Promise<void>,
  ): Promise<BookOutcome> {
    if (this.running()) {
      return 'failed';
    }
    this.running.set({ bookId: book.id, action });
    try {
      await work(this.familyId);
      return 'done';
    } catch (error) {
      return this.changeFailed(error, book.id);
    } finally {
      this.running.set(null);
    }
  }

  /**
   * Explains a change to a book that failed: a family the parent is no
   * longer in moves the page on, a change made meanwhile is said and the
   * book and the children are read again, and anything else is 出了点问题.
   */
  private changeFailed(error: unknown, bookId: string): BookOutcome {
    if (error instanceof ApiError && error.code === 'family_not_found') {
      this.notFound();
      return 'changed';
    }
    explainChange(error, this.toaster, CHANGED_MEANWHILE, () => {
      void this.readBook(bookId);
    });
    const { code } = asApiError(error);
    return code !== 'network' && CHANGED_MEANWHILE[code] ? 'changed' : 'failed';
  }

  /**
   * Reads one book and the children again after a change made meanwhile. A
   * book the family can no longer see leaves the list.
   */
  private async readBook(bookId: string): Promise<void> {
    const familyId = this.familyId;
    try {
      const [detail, children] = await Promise.all([
        this.api.get(bookPath(familyId, bookId), bookDetailSchema),
        this.api.get(familyPath(familyId, '/children'), childListSchema),
      ]);
      if (familyId === this.familyId) {
        this.shownChildren.set(children);
        this.update(familyId, detail);
      }
    } catch (error) {
      if (familyId === this.familyId && asApiError(error).code === 'book_not_found') {
        this.reads.wrote();
        this.shownListing.update(
          (listing) =>
            listing && { ...listing, books: listing.books.filter(({ id }) => id !== bookId) },
        );
      }
    }
  }

  /**
   * Shows the book as a change to the family `familyId` left it, while the
   * page still shows that family. An inactive book leaves the library's
   * own scope, and every scope once the family no longer has it.
   */
  private update(familyId: string, detail: BookDetail): void {
    if (familyId !== this.familyId) {
      return;
    }
    this.reads.wrote();
    const card = asCard(detail);
    this.shownListing.update((listing) => {
      if (!listing) {
        return listing;
      }
      const gone =
        card.status === 'inactive' && (listing.query.scope === 'library' || !card.acquired);
      return {
        ...listing,
        books: gone
          ? listing.books.filter(({ id }) => id !== card.id)
          : listing.books.map((shown) => (shown.id === card.id ? card : shown)),
      };
    });
  }

  /**
   * The parent is no longer a member of the family: the page says so while
   * the parent's families are read again, which moves the page to another
   * family, or to the start page when none is left.
   */
  private notFound(): void {
    this.reads.wrote();
    this.shownListing.set(null);
    this.shownTrouble.set('not-found');
    void this.session.refresh().then(() => {
      if ((this.session.me()?.families.length ?? 0) === 0) {
        void this.router.navigateByUrl('/start');
      }
    });
  }
}
