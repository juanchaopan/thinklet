import { Inject, Injectable } from '@nestjs/common';
import type { BookStatus } from '@thinklet/contracts';
import { and, asc, desc, eq, exists, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  DATABASE,
  type Database,
  type Executor,
} from '../../infrastructure/database/database.module.js';
import * as schema from '../../infrastructure/database/schema.js';
import {
  FOREIGN_KEY_VIOLATIONS,
  translatingConstraintViolation,
} from '../../infrastructure/database/unique-violation.js';
import type { BookPosition } from './book-cursor.js';

const { books, grades, subjects, familyBooks, bookAssignments } = schema;

/** The book that takes an inactive book's place, joined under its own name. */
const replacements = alias(books, 'replacements');

/** The lowest and the highest grade of a book, each joined under its own name. */
const minGrades = alias(grades, 'min_grades');
const maxGrades = alias(grades, 'max_grades');

/** The key that ties an assignment to a child of the family. */
const ASSIGNMENT_CHILD_KEY = 'book_assignments_child_fk';

/** The key that keeps a family's book while a child of the family reads it. */
const ASSIGNMENT_FAMILY_BOOK_KEY = 'book_assignments_family_book_fk';

/** A child to assign the book to is gone: deleted since it was looked up. The statement is aborted. */
export class ReaderGoneError extends Error {
  constructor(options?: ErrorOptions) {
    super('A child to assign the book to does not exist', options);
    this.name = 'ReaderGoneError';
  }
}

/** A child of the family still reads the book, so the family's book cannot be removed. */
export class BookInUseError extends Error {
  constructor(options?: ErrorOptions) {
    super('A child still reads the book', options);
    this.name = 'BookInUseError';
  }
}

/** A grade or a subject as books name it. */
export interface NamedRecord {
  id: string;
  name: string;
}

/** A grade with its level, by which the library compares grades. */
export interface GradeRecord extends NamedRecord {
  level: number;
}

/** Where books are listed from: the active books, the family's books, or those of one child of the family. */
export type ScopeFilter =
  | { scope: 'library' | 'family'; familyId: string }
  | { scope: 'child'; familyId: string; childId: string };

/**
 * What the library lists: the scope, the levels of the grades a book has
 * to cover at least one of, and the subjects to keep; none means all.
 */
export type BookFilter = ScopeFilter & {
  gradeLevels: readonly number[];
  subjectIds?: readonly string[];
};

/**
 * A book with the lowest and highest grades it is written for and its
 * subject, as every view of it shows. The grade it teaches at is not read:
 * no view shows it.
 */
export interface BookRecord {
  id: string;
  title: string;
  intro: string;
  minGrade: NamedRecord;
  maxGrade: NamedRecord;
  subject: NamedRecord;
  status: BookStatus;
  coverSha256: string | null;
}

/** A book of the library list, with whether the family has it and its place in the order. */
export interface LibraryBookRecord extends BookRecord {
  acquired: boolean;
  position: BookPosition;
}

/** A book as its page shows it to a family. */
export interface BookDetailRecord extends BookRecord {
  acquired: boolean;
  replacement: { id: string; title: string; status: BookStatus } | null;
}

/** A book assigned to a child; a null `openedAt` marks one the child has not opened. */
export interface ChildBookRecord extends BookRecord {
  openedAt: Date | null;
}

/** A child who reads one of the family's books. */
export interface ReaderRecord {
  bookId: string;
  childId: string;
}

/** A book's cover as the cover import recorded it. */
export interface CoverRecord {
  type: schema.CoverType;
  sha256: string;
}

/** The columns every view of a book reads, from the books joined to their grades and subject. */
const bookColumns = {
  id: books.id,
  title: books.title,
  intro: books.intro,
  minGradeId: minGrades.id,
  minGradeName: minGrades.name,
  maxGradeId: maxGrades.id,
  maxGradeName: maxGrades.name,
  subjectId: subjects.id,
  subjectName: subjects.name,
  status: books.status,
  coverSha256: books.coverSha256,
};

/** A row of the book columns. */
interface BookRow {
  id: string;
  title: string;
  intro: string;
  minGradeId: string;
  minGradeName: string;
  maxGradeId: string;
  maxGradeName: string;
  subjectId: string;
  subjectName: string;
  status: BookStatus;
  coverSha256: string | null;
}

function toBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    title: row.title,
    intro: row.intro,
    minGrade: { id: row.minGradeId, name: row.minGradeName },
    maxGrade: { id: row.maxGradeId, name: row.maxGradeName },
    subject: { id: row.subjectId, name: row.subjectName },
    status: row.status,
    coverSha256: row.coverSha256,
  };
}

/** The joins of the book columns: a book's lowest and highest grades and its subject. */
const minGradeOfBook = eq(minGrades.id, books.minGradeId);
const maxGradeOfBook = eq(maxGrades.id, books.maxGradeId);
const subjectOfBook = eq(subjects.id, books.subjectId);

/**
 * `created_at` as UTC text to the microsecond, the form a cursor carries;
 * PostgreSQL keeps microseconds, a JavaScript Date only milliseconds.
 */
const createdAtText = sql<string>`to_char(${books.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Whether the family has the book of the current row. */
const acquiredBy = (familyId: string): SQL<boolean> =>
  sql<boolean>`exists (select 1 from ${familyBooks} where ${familyBooks.familyId} = ${familyId} and ${familyBooks.bookId} = ${books.id})`;

/** The books of the scope: the active books, the family's (inactive too), or the child's (inactive too). */
function inScope(filter: ScopeFilter): SQL {
  switch (filter.scope) {
    case 'library':
      return eq(books.status, 'active');
    case 'family':
      return acquiredBy(filter.familyId);
    case 'child':
      return sql`exists (select 1 from ${bookAssignments} where ${bookAssignments.familyId} = ${filter.familyId} and ${bookAssignments.childId} = ${filter.childId} and ${bookAssignments.bookId} = ${books.id})`;
  }
}

/**
 * The books whose range of grades covers at least one of the levels, both
 * ends of the range included (`.docs/design/interfaces.md`, "书库和书本");
 * no levels keeps every book.
 */
function coveringAnyOf(levels: readonly number[]): SQL | undefined {
  if (levels.length === 0) {
    return undefined;
  }
  return or(
    ...levels.map((level) => and(lte(books.minGradeLevel, level), gte(books.maxGradeLevel, level))),
  );
}

/** The books of the filter; a list of grades or subjects that is empty keeps them all. */
function matching(filter: BookFilter): SQL | undefined {
  return and(
    inScope(filter),
    coveringAnyOf(filter.gradeLevels),
    filter.subjectIds !== undefined && filter.subjectIds.length > 0
      ? inArray(books.subjectId, [...filter.subjectIds])
      : undefined,
  );
}

/** The books after the position in the library's order: older, or as old with a later id. */
const after = (position: BookPosition): SQL =>
  sql`(${books.createdAt} < ${position.createdAt}::timestamptz or (${books.createdAt} = ${position.createdAt}::timestamptz and ${books.id} > ${position.id}))`;

/** The family's book, by family and book. */
const familyBook = (familyId: string, bookId: string) =>
  and(eq(familyBooks.familyId, familyId), eq(familyBooks.bookId, bookId));

/** The assignments of the family's book. */
const assignmentsOf = (familyId: string, bookId: string) =>
  and(eq(bookAssignments.familyId, familyId), eq(bookAssignments.bookId, bookId));

/**
 * The queries on the library, the families' books and the children's
 * assignments, on the pool or inside one transaction. The books are read
 * only; families and children are named by id and never read here.
 */
export class BookStore {
  constructor(protected readonly executor: Executor) {}

  /** Every grade with its level, in its set order. */
  listGrades(): Promise<GradeRecord[]> {
    return this.executor
      .select({ id: grades.id, name: grades.name, level: grades.level })
      .from(grades)
      .orderBy(asc(grades.position));
  }

  /** Every subject in its set order. */
  listSubjects(): Promise<NamedRecord[]> {
    return this.executor
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .orderBy(asc(subjects.position));
  }

  /** The subjects, in their set order, that have books of the scope in the grades (all when none). */
  listSubjectsWithBooks(filter: BookFilter): Promise<NamedRecord[]> {
    return this.executor
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(
        exists(
          this.executor
            .select({ one: sql`1` })
            .from(books)
            .where(and(eq(books.subjectId, subjects.id), matching(filter))),
        ),
      )
      .orderBy(asc(subjects.position));
  }

  /**
   * Up to `limit` books of the filter in the library's order, newest first
   * and then by id, after the position when one is given.
   */
  async listBooks(
    filter: BookFilter,
    position: BookPosition | undefined,
    limit: number,
  ): Promise<LibraryBookRecord[]> {
    const rows = await this.executor
      .select({
        ...bookColumns,
        acquired: acquiredBy(filter.familyId),
        createdAt: createdAtText,
      })
      .from(books)
      .innerJoin(minGrades, minGradeOfBook)
      .innerJoin(maxGrades, maxGradeOfBook)
      .innerJoin(subjects, subjectOfBook)
      .where(and(matching(filter), position === undefined ? undefined : after(position)))
      .orderBy(desc(books.createdAt), asc(books.id))
      .limit(limit);
    return rows.map((row) => ({
      ...toBook(row),
      acquired: row.acquired,
      position: { createdAt: row.createdAt, id: row.id },
    }));
  }

  /** The book as the family sees it, or undefined when there is no such book. */
  async findBook(familyId: string, bookId: string): Promise<BookDetailRecord | undefined> {
    const rows = await this.executor
      .select({
        ...bookColumns,
        acquired: acquiredBy(familyId),
        replacementId: replacements.id,
        replacementTitle: replacements.title,
        replacementStatus: replacements.status,
      })
      .from(books)
      .innerJoin(minGrades, minGradeOfBook)
      .innerJoin(maxGrades, maxGradeOfBook)
      .innerJoin(subjects, subjectOfBook)
      .leftJoin(replacements, eq(replacements.id, books.replacementId))
      .where(eq(books.id, bookId));
    const row = rows.at(0);
    if (row === undefined) {
      return undefined;
    }
    const { replacementId, replacementTitle, replacementStatus } = row;
    return {
      ...toBook(row),
      acquired: row.acquired,
      replacement:
        replacementId === null || replacementTitle === null || replacementStatus === null
          ? null
          : { id: replacementId, title: replacementTitle, status: replacementStatus },
    };
  }

  /** The book's status, or undefined when there is no such book. */
  async findStatus(bookId: string): Promise<BookStatus | undefined> {
    const rows = await this.executor
      .select({ status: books.status })
      .from(books)
      .where(eq(books.id, bookId));
    return rows.at(0)?.status;
  }

  /** The book's cover, or undefined when there is no such book or it has no cover yet. */
  async findCover(bookId: string): Promise<CoverRecord | undefined> {
    const rows = await this.executor
      .select({ type: books.coverType, sha256: books.coverSha256 })
      .from(books)
      .where(eq(books.id, bookId));
    const row = rows.at(0);
    if (row?.type == null || row.sha256 === null) {
      return undefined;
    }
    return { type: row.type, sha256: row.sha256 };
  }

  /** Whether the family has the book. */
  async isAcquired(familyId: string, bookId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ bookId: familyBooks.bookId })
      .from(familyBooks)
      .where(familyBook(familyId, bookId));
    return rows.length > 0;
  }

  /**
   * Records that the family has the book and returns whether it is new to
   * the family; a family that has it already keeps its record.
   */
  async insertFamilyBook(familyId: string, bookId: string): Promise<boolean> {
    const rows = await this.executor
      .insert(familyBooks)
      .values({ familyId, bookId })
      .onConflictDoNothing()
      .returning({ bookId: familyBooks.bookId });
    return rows.length > 0;
  }

  /**
   * Locks the family's book until the transaction ends, so the changes to
   * its readers and its removal run one after another, each seeing what the
   * one before it left. An assignment written elsewhere waits for the lock
   * too, through its key to the family's book. Returns whether the family
   * has the book.
   */
  async lockFamilyBook(familyId: string, bookId: string): Promise<boolean> {
    const rows = await this.executor
      .select({ bookId: familyBooks.bookId })
      .from(familyBooks)
      .where(familyBook(familyId, bookId))
      .for('update');
    return rows.length > 0;
  }

  /**
   * Removes the family's book; throws BookInUseError when a child of the
   * family still reads it, which the assignments' key refuses.
   */
  async deleteFamilyBook(familyId: string, bookId: string): Promise<void> {
    await translatingConstraintViolation(
      FOREIGN_KEY_VIOLATIONS,
      ASSIGNMENT_FAMILY_BOOK_KEY,
      (options) => new BookInUseError(options),
      () => this.executor.delete(familyBooks).where(familyBook(familyId, bookId)),
    );
  }

  /** The children of the family who read the family's book. */
  async readerIds(familyId: string, bookId: string): Promise<string[]> {
    const rows = await this.executor
      .select({ childId: bookAssignments.childId })
      .from(bookAssignments)
      .where(assignmentsOf(familyId, bookId));
    return rows.map((row) => row.childId);
  }

  /** Who reads each of the family's books among those given. */
  async listReaders(familyId: string, bookIds: readonly string[]): Promise<ReaderRecord[]> {
    if (bookIds.length === 0) {
      return [];
    }
    return this.executor
      .select({ bookId: bookAssignments.bookId, childId: bookAssignments.childId })
      .from(bookAssignments)
      .where(
        and(eq(bookAssignments.familyId, familyId), inArray(bookAssignments.bookId, [...bookIds])),
      );
  }

  /**
   * Assigns the family's book to the children, as new books they have not
   * opened. Throws ReaderGoneError when one of them is not a child of the
   * family any more, which the assignments' key to the children refuses.
   */
  async insertAssignments(
    familyId: string,
    bookId: string,
    childIds: readonly string[],
  ): Promise<void> {
    if (childIds.length === 0) {
      return;
    }
    await translatingConstraintViolation(
      FOREIGN_KEY_VIOLATIONS,
      ASSIGNMENT_CHILD_KEY,
      (options) => new ReaderGoneError(options),
      () =>
        this.executor
          .insert(bookAssignments)
          .values(childIds.map((childId) => ({ childId, familyId, bookId }))),
    );
  }

  /** Takes the family's book from the children. */
  async deleteAssignments(
    familyId: string,
    bookId: string,
    childIds: readonly string[],
  ): Promise<void> {
    if (childIds.length === 0) {
      return;
    }
    await this.executor
      .delete(bookAssignments)
      .where(and(assignmentsOf(familyId, bookId), inArray(bookAssignments.childId, [...childIds])));
  }

  /** The books assigned to the child, latest assignment first, then by id. */
  async listChildBooks(childId: string): Promise<ChildBookRecord[]> {
    const rows = await this.executor
      .select({ ...bookColumns, openedAt: bookAssignments.openedAt })
      .from(bookAssignments)
      .innerJoin(books, eq(books.id, bookAssignments.bookId))
      .innerJoin(minGrades, minGradeOfBook)
      .innerJoin(maxGrades, maxGradeOfBook)
      .innerJoin(subjects, subjectOfBook)
      .where(eq(bookAssignments.childId, childId))
      .orderBy(desc(bookAssignments.assignedAt), asc(books.id));
    return rows.map((row) => ({ ...toBook(row), openedAt: row.openedAt }));
  }
}

/**
 * The library, the families' books and the children's assignments. Its own
 * queries run on the pool; `transaction` runs a unit of work with the same
 * queries inside one transaction, and hands the work the transaction too,
 * for the audit event of its change.
 */
@Injectable()
export class BooksRepository extends BookStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super(database);
  }

  /** Runs the work in one transaction, committed when it resolves and rolled back when it throws. */
  transaction<T>(work: (store: BookStore, transaction: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      work(new BookStore(transaction), transaction),
    );
  }
}
