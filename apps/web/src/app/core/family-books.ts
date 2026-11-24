import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  bookDetailSchema,
  childListSchema,
  type BookDetail,
  type Child,
  type ErrorCode,
} from '@thinklet/contracts';
import { Toaster } from '../shared/ui/toast';
import { Api, ApiError } from './api';
import { explainChange } from './failures';
import { familyPath } from './family-pages';
import { Session } from './session';

/** A change to one of the family's books; only one runs at a time. */
export type BookAction = 'acquire' | 'readers' | 'remove';

/** The change to a book running now. */
export interface RunningBookChange {
  readonly bookId: string;
  readonly action: BookAction;
}

/**
 * How a change ended: `done`; `failed`, said in a toast, with what is on the
 * screen left as it was; or `changed`, the book, a child or the family
 * changed meanwhile, and the page is brought up to date with what is there
 * now.
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

/** The address of one of the family's books in the api, with what follows it. */
export function bookPath(familyId: string, bookId: string, suffix = ''): string {
  return familyPath(familyId, `/books/${encodeURIComponent(bookId)}${suffix}`);
}

/**
 * One family's books as the library and the book page change them
 * (interfaces.md, 书库和书本（家长）): a book's details, the family's
 * children, acquiring a book, setting who reads it and removing it from
 * the family's books.
 */
@Injectable({ providedIn: 'root' })
export class FamilyBooks {
  private readonly api = inject(Api);

  /** The book as the family sees it. */
  detail(familyId: string, bookId: string): Promise<BookDetail> {
    return this.api.get(bookPath(familyId, bookId), bookDetailSchema);
  }

  /** The family's children in the order they were added. */
  children(familyId: string): Promise<Child[]> {
    return this.api.get(familyPath(familyId, '/children'), childListSchema);
  }

  /** Takes the book into the family's books; a book the family has already stays as it is. */
  acquire(familyId: string, bookId: string): Promise<BookDetail> {
    return this.api.send(
      'PUT',
      bookPath(familyId, bookId, '/acquisition'),
      undefined,
      bookDetailSchema,
    );
  }

  /** Makes the children with the ids the book's readers, every one of them. */
  setReaders(familyId: string, bookId: string, childIds: readonly string[]): Promise<BookDetail> {
    return this.api.send(
      'PUT',
      bookPath(familyId, bookId, '/readers'),
      { childIds },
      bookDetailSchema,
    );
  }

  /** Takes the book out of the family's books. */
  remove(familyId: string, bookId: string): Promise<void> {
    return this.api.sendWithoutContent('DELETE', bookPath(familyId, bookId, '/acquisition'));
  }
}

/** What a page does when a change to a book did not go through. */
export interface BookChangeHandlers {
  /** The parent is no longer a member of the family. */
  familyLost(): void;
  /**
   * The book no longer exists, or the family can no longer see it: the page
   * shows what is there now without a word (interfaces.md, book_not_found).
   */
  bookGone(bookId: string): void;
  /** The book, a child or the family changed meanwhile: the book and the children are read again. */
  readAgain(bookId: string): void;
}

/**
 * Runs the changes a page makes to the family's books, one at a time, and
 * explains those that fail: a family the parent is no longer in and a book
 * that is gone are the page's to show, a change made meanwhile is said in a
 * toast and the book read again, and anything else is 出了点问题 with the
 * screen left as it was.
 *
 * Create it where `inject` works, such as a field initializer.
 */
export class BookChanges {
  private readonly toaster = inject(Toaster);
  private readonly running = signal<RunningBookChange | null>(null);

  /** The change running now. */
  readonly busy = this.running.asReadonly();

  constructor(private readonly handlers: BookChangeHandlers) {}

  /**
   * Runs one change to the book while it is marked busy. While another one
   * runs, nothing is done and the answer is `failed`.
   */
  async run(bookId: string, action: BookAction, work: () => Promise<void>): Promise<BookOutcome> {
    if (this.running()) {
      return 'failed';
    }
    this.running.set({ bookId, action });
    try {
      await work();
      return 'done';
    } catch (error) {
      return this.failed(error, bookId);
    } finally {
      this.running.set(null);
    }
  }

  private failed(error: unknown, bookId: string): BookOutcome {
    const code = error instanceof ApiError ? error.code : null;
    if (code === 'family_not_found') {
      this.handlers.familyLost();
      return 'changed';
    }
    if (code === 'book_not_found') {
      this.handlers.bookGone(bookId);
      return 'changed';
    }
    const changed = explainChange(error, this.toaster, CHANGED_MEANWHILE, () => {
      this.handlers.readAgain(bookId);
    });
    return changed ? 'changed' : 'failed';
  }
}

/**
 * Reads the parent's families again after the parent turned out to be no
 * longer a member of the current one: the current family becomes another
 * one, or, with none left, the parent goes to the start page.
 */
export function leaveLostFamily(session: Session, router: Router): void {
  void session.refresh().then(() => {
    if ((session.me()?.families.length ?? 0) === 0) {
      void router.navigateByUrl('/start');
    }
  });
}
