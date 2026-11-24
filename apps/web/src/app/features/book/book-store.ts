import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { BookDetail, Child } from '@thinklet/contracts';
import {
  BookChanges,
  FamilyBooks,
  leaveLostFamily,
  type BookAction,
  type BookOutcome,
} from '../../core/family-books';
import { readTrouble, type FamilyTrouble } from '../../core/family-pages';
import { FreshReads } from '../../core/fresh-reads';
import { Session } from '../../core/session';
import { Toaster } from '../../shared/ui/toast';

/**
 * Why the page shows no book: the family's troubles, or `book-not-found`
 * for a book that does not exist or that the family cannot see (an
 * inactive book it does not have).
 */
export type BookTrouble = FamilyTrouble | 'book-not-found';

/**
 * One book of the current family at `/books/<id>` (rules.md, 书本页;
 * interfaces.md, 书库和书本（家长）): the book as the family sees it and the
 * family's children; acquiring the book, choosing who reads it and removing
 * it from the family's books.
 *
 * A read shows its answer only when no newer read started and no change was
 * shown meanwhile, and a change shows its answer only while the page still
 * shows the same book of the same family. A change the book or the children
 * went through meanwhile is said in a toast and the page read again
 * (core/family-books); a book that turns out to be gone during a change
 * makes the page read again without a word, which shows 找不到这本书 for the
 * family shown then; a family the parent is no longer in makes the parent's
 * families read again, so the page moves to another family's view of the
 * book, or to the start page without one. The page provides its own
 * instance.
 */
@Injectable()
export class BookStore {
  private readonly books = inject(FamilyBooks);
  private readonly toaster = inject(Toaster);
  private readonly changes = new BookChanges({
    familyLost: () => {
      this.familyLost();
    },
    bookGone: () => void this.read(),
    readAgain: () => void this.read(),
  });
  private readonly reads = new FreshReads();
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  /** The family and the book shown. */
  private familyId = '';
  private bookId = '';

  private readonly shownBook = signal<BookDetail | null>(null);
  private readonly shownChildren = signal<readonly Child[]>([]);
  private readonly shownTrouble = signal<BookTrouble | null>(null);

  /** The book as the family sees it; null until it has been read, and while there is trouble. */
  readonly book = this.shownBook.asReadonly();
  /** The family's children in the order they were added. */
  readonly children = this.shownChildren.asReadonly();
  /** Why the page shows no book, if it does not. */
  readonly trouble = this.shownTrouble.asReadonly();
  /** The change to the book running now. */
  readonly busy = this.changes.busy;

  /** Shows the book with the id as the family with the id sees it, read afresh. */
  async open(familyId: string, bookId: string): Promise<void> {
    this.familyId = familyId;
    this.bookId = bookId;
    this.shownBook.set(null);
    this.shownChildren.set([]);
    this.shownTrouble.set(null);
    await this.read();
  }

  /**
   * Reads the book and the children again. A failure while a book is shown
   * leaves it as it is, without a word.
   */
  async load(): Promise<void> {
    await this.read();
  }

  /** Takes the book into the family's books, without a word: the button's change is the answer. */
  acquire(): Promise<BookOutcome> {
    return this.change('acquire', async (familyId, book) => {
      this.show(familyId, book.id, await this.books.acquire(familyId, book.id));
    });
  }

  /** Sets the children who read the book, without a word: the avatars are the answer. */
  setReaders(childIds: readonly string[]): Promise<BookOutcome> {
    return this.change('readers', async (familyId, book) => {
      this.show(familyId, book.id, await this.books.setReaders(familyId, book.id, childIds));
    });
  }

  /**
   * Removes the book from the family's books, saying 已移除《<title>》. The
   * page stays: the book goes back to 获取, and an inactive book, which the
   * family can no longer see, becomes 找不到这本书.
   */
  remove(): Promise<BookOutcome> {
    return this.change('remove', async (familyId, book) => {
      await this.books.remove(familyId, book.id);
      if (book.status === 'inactive') {
        this.showNotFound(familyId, book.id);
      } else {
        this.show(familyId, book.id, { ...book, acquired: false, readers: [] });
      }
      this.toaster.show(`已移除《${book.title}》`, 'success', 'door');
    });
  }

  /** Runs a change to the book shown, if there is one. */
  private change(
    action: BookAction,
    work: (familyId: string, book: BookDetail) => Promise<void>,
  ): Promise<BookOutcome> {
    const book = this.shownBook();
    if (!book) {
      return Promise.resolve('failed');
    }
    const familyId = this.familyId;
    return this.changes.run(book.id, action, () => work(familyId, book));
  }

  /** Reads the book and the children, and shows them unless something newer was shown meanwhile. */
  private async read(): Promise<void> {
    const { familyId, bookId } = this;
    const fresh = this.reads.start();
    try {
      const [book, children] = await Promise.all([
        this.books.detail(familyId, bookId),
        this.books.children(familyId),
      ]);
      if (fresh()) {
        this.shownChildren.set(children);
        this.shownTrouble.set(null);
        this.shownBook.set(book);
      }
    } catch (error) {
      if (fresh()) {
        this.readFailed(error);
      }
    }
  }

  /**
   * A read that failed: a family the parent is not in moves the page on, a
   * book the family cannot see is 找不到这本书, and any other failure is
   * shown in place of the book unless a book is shown already, which stays.
   */
  private readFailed(error: unknown): void {
    const trouble = readTrouble(error);
    if (trouble === null) {
      return;
    }
    if (trouble === 'not-found') {
      this.familyLost();
    } else if (trouble.code === 'book_not_found') {
      this.showNotFound(this.familyId, this.bookId);
    } else if (this.shownBook() === null) {
      this.shownTrouble.set(trouble);
    }
  }

  /** Shows the book as a change left it, while the page still shows it for that family. */
  private show(familyId: string, bookId: string, book: BookDetail): void {
    if (this.shows(familyId, bookId)) {
      this.reads.wrote();
      this.shownBook.set(book);
    }
  }

  /** Shows 找不到这本书, while the page still shows that book for that family. */
  private showNotFound(familyId: string, bookId: string): void {
    if (this.shows(familyId, bookId)) {
      this.reads.wrote();
      this.shownBook.set(null);
      this.shownTrouble.set('book-not-found');
    }
  }

  private shows(familyId: string, bookId: string): boolean {
    return familyId === this.familyId && bookId === this.bookId;
  }

  /**
   * The parent is no longer a member of the family: the page says so while
   * the parent's families are read again, which moves the page to another
   * family, or to the start page when none is left.
   */
  private familyLost(): void {
    this.reads.wrote();
    this.shownBook.set(null);
    this.shownTrouble.set('not-found');
    leaveLostFamily(this.session, this.router);
  }
}
