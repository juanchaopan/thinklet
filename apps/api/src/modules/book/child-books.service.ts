import { Injectable } from '@nestjs/common';
import type { ChildBook, ChildBooksResponse } from '@thinklet/contracts';
import { toBookSummary } from './book-summary.js';
import { BooksRepository, type ChildBookRecord } from './books.repository.js';

/** A book assigned to the child as the child's home page shows it; new until the child opens it. */
export function toChildBook(book: ChildBookRecord): ChildBook {
  return { ...toBookSummary(book), isNew: book.openedAt === null };
}

/**
 * The books of the signed-in child (`.docs/design/interfaces.md`,
 * "孩子（孩子登录后）"): only those assigned to the child, so a child sees
 * no other child's books. The routes' child login check runs before it.
 */
@Injectable()
export class ChildBooksService {
  constructor(private readonly repository: BooksRepository) {}

  /** Every book assigned to the child, latest assignment first, and how many are new. */
  async books(childId: string): Promise<ChildBooksResponse> {
    const books = (await this.repository.listChildBooks(childId)).map(toChildBook);
    return { books, newCount: books.filter(({ isNew }) => isNew).length };
  }
}
