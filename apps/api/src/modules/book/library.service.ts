import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  BookCard,
  BookDetail,
  BookFiltersQuery,
  BookFiltersResponse,
  BookListQuery,
  BookListResponse,
  BookReader,
  BookStatus,
} from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { childNotFound, ChildrenService } from '../child/children.service.js';
import { decodeCursor, encodeCursor, type BookPosition } from './book-cursor.js';
import { toBookSummary } from './book-summary.js';
import {
  BookInUseError,
  BooksRepository,
  ReaderGoneError,
  type BookDetailRecord,
  type LibraryBookRecord,
  type NamedRecord,
  type ReaderRecord,
  type ScopeFilter,
} from './books.repository.js';

/** How many books a batch of the library holds (`.docs/design/rules.md`, "加载更多"). */
export const BOOK_BATCH_SIZE = 12;

/** A book that does not exist, and an inactive book the family does not have, are answered the same. */
export const bookNotFound = () => new ApiError('book_not_found', HttpStatus.NOT_FOUND);

const bookInUse = () => new ApiError('book_in_use', HttpStatus.CONFLICT);
const bookNotAcquired = () => new ApiError('book_not_acquired', HttpStatus.CONFLICT);
const bookInactive = () => new ApiError('book_inactive', HttpStatus.CONFLICT);
const invalidCursor = () =>
  new ApiError('invalid_request', HttpStatus.BAD_REQUEST, [{ path: 'cursor', code: 'invalid' }]);

/** A child of the family as the books show it, from the children in the order they were added. */
export interface FamilyChild {
  id: string;
  nickname: string;
}

/** The children to assign a book to and those to take it from. */
export interface ReaderChanges {
  added: string[];
  removed: string[];
}

/**
 * The requested ids that exist among the known ones, in the order known.
 * An id that does not exist is no part of the filter, so a filter of only
 * such ids takes in everything (`.docs/design/interfaces.md`, "书库和书本").
 */
export function knownIds(requested: readonly string[], known: readonly NamedRecord[]): string[] {
  const wanted = new Set(requested);
  return known.filter(({ id }) => wanted.has(id)).map(({ id }) => id);
}

/**
 * The scope of the query within the family. The child of the `child`
 * scope has to be one of the family's children, else 404
 * `child_not_found`; `child` with any other scope is ignored.
 */
export function scopeOf(
  familyId: string,
  query: BookFiltersQuery,
  children: readonly FamilyChild[],
): ScopeFilter {
  if (query.scope !== 'child') {
    return { scope: query.scope, familyId };
  }
  const childId = query.child;
  if (childId === undefined || !children.some(({ id }) => id === childId)) {
    throw childNotFound();
  }
  return { scope: 'child', familyId, childId };
}

/**
 * How setting a book's readers to `wanted` changes them from `current`
 * (`.docs/design/rules.md`, "谁能读"): the children to add and those to
 * take the book from; a child who reads it already stays as they are, so
 * the time of the assignment and whether they opened it are kept. Every
 * wanted child has to be one of the family's, else 404 `child_not_found`
 * and nothing changes. An inactive book can only be taken away: adding a
 * child is 409 `book_inactive`.
 */
export function planReaders(
  status: BookStatus,
  current: readonly string[],
  wanted: readonly string[],
  familyChildIds: ReadonlySet<string>,
): ReaderChanges {
  if (wanted.some((id) => !familyChildIds.has(id))) {
    throw childNotFound();
  }
  const keep = new Set(wanted);
  const reading = new Set(current);
  const changes = {
    added: [...keep].filter((id) => !reading.has(id)),
    removed: current.filter((id) => !keep.has(id)),
  };
  if (status === 'inactive' && changes.added.length > 0) {
    throw bookInactive();
  }
  return changes;
}

/** Each book's readers, in the order the family's children were added. */
export function readersByBook(
  readers: readonly ReaderRecord[],
  children: readonly FamilyChild[],
): Map<string, BookReader[]> {
  const childIdsByBook = new Map<string, Set<string>>();
  for (const { bookId, childId } of readers) {
    childIdsByBook.set(bookId, (childIdsByBook.get(bookId) ?? new Set()).add(childId));
  }
  return new Map(
    [...childIdsByBook].map(([bookId, childIds]) => [
      bookId,
      children
        .filter(({ id }) => childIds.has(id))
        .map(({ id, nickname }) => ({ childId: id, nickname })),
    ]),
  );
}

/** A book of the list or page as the family sees it, with its readers. */
function toCard(
  book: LibraryBookRecord | BookDetailRecord,
  readers: ReadonlyMap<string, BookReader[]>,
): BookCard {
  return {
    ...toBookSummary(book),
    acquired: book.acquired,
    readers: readers.get(book.id) ?? [],
  };
}

/**
 * The book that takes an inactive book's place, only when it is active
 * itself (`.docs/design/interfaces.md`, "书本详情").
 */
export function replacementOf(book: BookDetailRecord): BookDetail['replacement'] {
  const { replacement } = book;
  if (book.status !== 'inactive' || replacement?.status !== 'active') {
    return null;
  }
  return { id: replacement.id, title: replacement.title };
}

/**
 * The library of a family and the family's books (`.docs/design/interfaces.md`,
 * "书库和书本（家长）"): listing and filtering the books, a book's page,
 * acquiring and removing a book, and setting the children who read it.
 * Every member of the family may use it; the routes' membership check runs
 * before it. The family's children are looked up through the child module,
 * which keeps their nicknames; this module stores only their ids.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly repository: BooksRepository,
    private readonly childrenService: ChildrenService,
  ) {}

  /**
   * One batch of the books of the query, newest first and then by id,
   * after the cursor's position when there is one; `nextCursor` names the
   * batch's last book when more follow. One book more than a batch is read
   * to tell whether more follow.
   */
  async list(familyId: string, query: BookListQuery): Promise<BookListResponse> {
    const position = this.positionOf(query.cursor);
    const children = await this.childrenService.list(familyId);
    const scope = scopeOf(familyId, query, children);
    const [grades, subjects] = await Promise.all([
      this.repository.listGrades(),
      this.repository.listSubjects(),
    ]);
    const rows = await this.repository.listBooks(
      {
        ...scope,
        gradeIds: knownIds(query.grade, grades),
        subjectIds: knownIds(query.subject, subjects),
      },
      position,
      BOOK_BATCH_SIZE + 1,
    );
    const batch = rows.slice(0, BOOK_BATCH_SIZE);
    const readers = readersByBook(
      await this.repository.listReaders(
        familyId,
        batch.filter(({ acquired }) => acquired).map(({ id }) => id),
      ),
      children,
    );
    const last = batch.at(-1);
    return {
      books: batch.map((book) => toCard(book, readers)),
      nextCursor:
        rows.length > BOOK_BATCH_SIZE && last !== undefined ? encodeCursor(last.position) : null,
    };
  }

  /**
   * Every grade, and the subjects that have books of the scope in the
   * grades asked for, both in their set order.
   */
  async filters(familyId: string, query: BookFiltersQuery): Promise<BookFiltersResponse> {
    const scope = scopeOf(familyId, query, await this.childrenService.list(familyId));
    const grades = await this.repository.listGrades();
    const subjects = await this.repository.listSubjectsWithBooks({
      ...scope,
      gradeIds: knownIds(query.grade, grades),
    });
    return { grades, subjects };
  }

  /**
   * The book's page for the family. A book that does not exist, or one
   * that is inactive and the family does not have, is 404 `book_not_found`.
   */
  async detail(familyId: string, bookId: string): Promise<BookDetail> {
    const book = await this.repository.findBook(familyId, bookId);
    if (book === undefined || (book.status === 'inactive' && !book.acquired)) {
      throw bookNotFound();
    }
    const readers = book.acquired
      ? readersByBook(
          await this.repository.listReaders(familyId, [bookId]),
          await this.childrenService.list(familyId),
        )
      : new Map<string, BookReader[]>();
    return { ...toCard(book, readers), replacement: replacementOf(book) };
  }

  /**
   * Takes the book into the family's books. A book the family has already
   * stays as it is, inactive or not; an inactive book the family does not
   * have is 409 `book_inactive`.
   */
  async acquire(parentId: string, familyId: string, bookId: string): Promise<BookDetail> {
    const status = await this.requireBook(bookId);
    if (status === 'active') {
      await this.repository.insertFamilyBook(familyId, bookId, parentId);
    } else if (!(await this.repository.isAcquired(familyId, bookId))) {
      throw bookInactive();
    }
    return this.detail(familyId, bookId);
  }

  /**
   * Removes the book from the family's books; a book the family does not
   * have leaves nothing to do. The family's book is locked first, so an
   * assignment made meanwhile either comes before the check and is seen,
   * or waits and then finds the book gone. A child who still reads it is
   * 409 `book_in_use`.
   */
  async remove(familyId: string, bookId: string): Promise<void> {
    await this.requireBook(bookId);
    await this.repository.transaction(async (store) => {
      if (!(await store.lockFamilyBook(familyId, bookId))) {
        return;
      }
      if ((await store.readerIds(familyId, bookId)).length > 0) {
        throw bookInUse();
      }
      try {
        await store.deleteFamilyBook(familyId, bookId);
      } catch (error) {
        throw error instanceof BookInUseError ? bookInUse() : error;
      }
    });
  }

  /**
   * Sets the children who read the family's book, in one transaction under
   * the family's book's lock, so the last change saved wins and none is
   * lost: new children are assigned the book, children left out have it
   * taken away, and children who read it already are not touched. A book
   * the family does not have is 409 `book_not_acquired`; a child who is
   * not the family's, or was deleted meanwhile, is 404 `child_not_found`
   * and nothing changes.
   */
  async setReaders(
    parentId: string,
    familyId: string,
    bookId: string,
    childIds: readonly string[],
  ): Promise<BookDetail> {
    const status = await this.requireBook(bookId);
    const children = await this.childrenService.list(familyId);
    const familyChildIds = new Set(children.map(({ id }) => id));
    await this.repository.transaction(async (store) => {
      if (!(await store.lockFamilyBook(familyId, bookId))) {
        throw bookNotAcquired();
      }
      const current = await store.readerIds(familyId, bookId);
      const { added, removed } = planReaders(status, current, childIds, familyChildIds);
      await store.deleteAssignments(familyId, bookId, removed);
      try {
        await store.insertAssignments(familyId, bookId, parentId, added);
      } catch (error) {
        throw error instanceof ReaderGoneError ? childNotFound() : error;
      }
    });
    return this.detail(familyId, bookId);
  }

  /** The book's status; a book that does not exist is 404 `book_not_found`. */
  private async requireBook(bookId: string): Promise<BookStatus> {
    const status = await this.repository.findStatus(bookId);
    if (status === undefined) {
      throw bookNotFound();
    }
    return status;
  }

  /** The position of the cursor; one this api did not make is 400 with the field `cursor`. */
  private positionOf(cursor: string | undefined): BookPosition | undefined {
    if (cursor === undefined) {
      return undefined;
    }
    const position = decodeCursor(cursor);
    if (position === undefined) {
      throw invalidCursor();
    }
    return position;
  }
}
