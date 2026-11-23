import type { ChildBook } from '@thinklet/contracts';
import type { BookRecord } from './books.repository.js';

/** What every view of a book shows: a family's card and page and a child's home page alike. */
export type BookSummary = Omit<ChildBook, 'isNew'>;

/**
 * The address a book's cover is read from (`.docs/design/interfaces.md`,
 * "封面"), carrying the cover's SHA-256 so that it changes with the cover
 * and the browser may keep it for good; null when the book has no cover
 * yet and the default cover is shown.
 */
export function coverUrl(bookId: string, sha256: string | null): string | null {
  return sha256 === null ? null : `/api/books/${bookId}/cover?v=${sha256}`;
}

/** The book as every view of it shows it, with its cover's address. */
export function toBookSummary(book: BookRecord): BookSummary {
  return {
    id: book.id,
    title: book.title,
    intro: book.intro,
    grade: book.grade,
    subject: book.subject,
    status: book.status,
    coverUrl: coverUrl(book.id, book.coverSha256),
  };
}
