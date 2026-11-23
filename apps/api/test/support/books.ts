import { bookDetailSchema, type BookDetail } from '@thinklet/contracts';
import request from 'supertest';
import { CHILD_SESSION_COOKIE } from './child-login.js';
import { query } from './database.js';
import { as, type Parent } from './families.js';
import { cookieHeader, testSessionTokens, type Target } from './login.js';

// Helpers for tests of the book routes: their paths, books acquired and
// assigned through the api, grades, subjects and books of a test's own
// written directly into the database, a child's login, and what the
// database holds about the families' books.

/** The library list of the family. */
export const booksPath = (familyId: string) => `/api/families/${familyId}/books`;

/** The filter options of the family's library. */
export const filtersPath = (familyId: string) => `/api/families/${familyId}/book-filters`;

/** One book as the family sees it. */
export const bookPath = (familyId: string, bookId: string) => `${booksPath(familyId)}/${bookId}`;

/** Acquiring and removing the book. */
export const acquisitionPath = (familyId: string, bookId: string) =>
  `${bookPath(familyId, bookId)}/acquisition`;

/** The children who read the book. */
export const readersPath = (familyId: string, bookId: string) =>
  `${bookPath(familyId, bookId)}/readers`;

/** The signed-in child's books. */
export const CHILD_BOOKS_PATH = '/api/child/books';

/** An active sample book of the first grade, and the inactive sample book that it replaces. */
export const ACTIVE_BOOK = 'carrot-counting';
export const INACTIVE_BOOK = 'bunny-counts';

/** A book of a family. */
export interface FamilyBook {
  familyId: string;
  bookId: string;
}

/** Acquires the book for the family as the parent through the api and returns it. */
export async function acquire(
  target: Target,
  parent: Parent,
  familyId: string,
  bookId: string,
): Promise<BookDetail> {
  const response = await as(target, parent).put(acquisitionPath(familyId, bookId), {});
  if (response.status !== 200) {
    throw new Error(`The book was not acquired: ${response.status}`);
  }
  return bookDetailSchema.parse(response.body);
}

/** Sets the children who read the family's book as the parent through the api and returns it. */
export async function setReaders(
  target: Target,
  parent: Parent,
  { familyId, bookId }: FamilyBook,
  childIds: string[],
): Promise<BookDetail> {
  const response = await as(target, parent).put(readersPath(familyId, bookId), { childIds });
  if (response.status !== 200) {
    throw new Error(`The readers were not set: ${response.status}`);
  }
  return bookDetailSchema.parse(response.body);
}

/** A Cookie header with a login of the child, as the child's login cookie carries it. */
export async function childLoginCookie(childId: string): Promise<string> {
  const login = await testSessionTokens().issueSession('child', childId);
  return cookieHeader({ [CHILD_SESSION_COOKIE]: login });
}

/** GET of the path as the signed-in child. */
export async function getAsChild(
  target: Target,
  childId: string,
  path: string,
): Promise<request.Response> {
  return request(target)
    .get(path)
    .set('Cookie', await childLoginCookie(childId));
}

let written = 0;

/** A name for something a test writes, unique within the test file's database. */
function uniqueName(prefix: string): string {
  written += 1;
  return `${prefix}-${written}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Writes a grade of the test's own, after every other in the order, so a
 * test can list books that no other test lists.
 */
export async function insertGrade(databaseUrl: string): Promise<string> {
  const id = uniqueName('test-grade');
  await query(
    databaseUrl,
    `insert into grades (id, name, level, position)
     values ($1, '测试年级', (select max(level) + 1 from grades), (select max(position) + 1 from grades))`,
    [id],
  );
  return id;
}

/** Writes a subject of the test's own, after every other in the order. */
export async function insertSubject(databaseUrl: string): Promise<string> {
  const id = uniqueName('test-subject');
  await query(
    databaseUrl,
    `insert into subjects (id, name, position)
     values ($1, '测试学科', (select max(position) + 1 from subjects))`,
    [id],
  );
  return id;
}

/** A book a test writes; the times are SQL timestamptz literals. */
export interface NewBook {
  id?: string;
  gradeId: string;
  subjectId: string;
  status?: 'active' | 'inactive';
  replacementId?: string;
  /** Long before the sample books by default, so the samples stay first in the library. */
  createdAt?: string;
}

/** Writes a book directly into the database, as a migration script does, and returns its id. */
export async function insertBook(databaseUrl: string, book: NewBook): Promise<string> {
  const id = book.id ?? uniqueName('test-book');
  await query(
    databaseUrl,
    `insert into books (id, title, intro, grade_id, subject_id, status, replacement_id, created_at)
     values ($1, $2, '测试用的书。', $3, $4, $5, $6, $7)`,
    [
      id,
      `书 ${id.slice(-8)}`,
      book.gradeId,
      book.subjectId,
      book.status ?? 'active',
      book.replacementId ?? null,
      book.createdAt ?? '2020-01-01 00:00:00+00',
    ],
  );
  return id;
}

/** The ids of the books in the library's order, newest first and then by id, with the condition. */
export async function bookIdsInOrder(databaseUrl: string, where: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    databaseUrl,
    `select id from books where ${where} order by created_at desc, id`,
  );
  return rows.map((row) => row.id);
}

/** A row of the family_books table. */
export interface FamilyBookRow {
  family_id: string;
  book_id: string;
  acquired_by: string;
  acquired_at: Date;
}

/** The family's books as the database holds them. */
export async function familyBookRows(
  databaseUrl: string,
  familyId: string,
): Promise<FamilyBookRow[]> {
  return query<FamilyBookRow>(
    databaseUrl,
    'select * from family_books where family_id = $1 order by book_id',
    [familyId],
  );
}

/** Records that the family has the book directly in the database, as a past acquisition did. */
export async function insertFamilyBook(
  databaseUrl: string,
  familyId: string,
  bookId: string,
  parentId: string,
): Promise<void> {
  await query(
    databaseUrl,
    'insert into family_books (family_id, book_id, acquired_by) values ($1, $2, $3)',
    [familyId, bookId, parentId],
  );
}

/** A row of the book_assignments table. */
export interface AssignmentRow {
  child_id: string;
  family_id: string;
  book_id: string;
  assigned_by: string;
  assigned_at: Date;
  opened_at: Date | null;
}

/** The assignments of the family's books as the database holds them. */
export async function assignmentRows(
  databaseUrl: string,
  familyId: string,
): Promise<AssignmentRow[]> {
  return query<AssignmentRow>(
    databaseUrl,
    'select * from book_assignments where family_id = $1 order by book_id, child_id',
    [familyId],
  );
}

/** Marks the child's book as opened directly in the database, as opening it will. */
export async function markOpened(
  databaseUrl: string,
  childId: string,
  bookId: string,
): Promise<void> {
  await query(
    databaseUrl,
    'update book_assignments set opened_at = now() where child_id = $1 and book_id = $2',
    [childId, bookId],
  );
}
