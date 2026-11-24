import type { ChildBook, ChildBooksResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { XIAOMING_ID } from './children';
import type { FakeLibrary } from './library';
import { worker } from './network';

// The books of the signed-in child as `GET /api/child/books` answers them,
// read from the fake library's assignments: what the parents of 林悦的家
// give a child, the child's home page shows.

/**
 * 小明's books as the design draws them on his home page, latest assignment
 * first, with whether he has opened each: 胡萝卜数数大冒险 and 四季里的古诗
 * are new.
 */
const XIAOMING_SHELF: ReadonlyArray<readonly [string, boolean]> = [
  ['carrot-counting', true],
  ['seasons-poems', true],
  ['write-a-diary', false],
  ['shape-hide-and-seek', false],
  ['bunny-counts', false],
];

/** No books assigned yet. */
export const NO_BOOKS: ChildBooksResponse = { books: [], newCount: 0 };

/** The child's books as the api answers them, from the fake library. */
export class FakeChildShelf {
  /** The child signed in on the child's side; 小明 unless a test signs in another. */
  childId = XIAOMING_ID;

  /** The books each child read when the fake started. */
  private readonly atStart: ReadonlyMap<string, readonly string[]>;

  constructor(private readonly library: FakeLibrary) {
    this.atStart = new Map(library.children.map(({ id }) => [id, this.readBy(id)]));
  }

  /**
   * The signed-in child's books, latest assignment first. Books assigned
   * after the fake started come first and are new; the books the child had
   * then follow, 小明's in the design's order and new where the design
   * draws them new, the other children's in the library's order.
   */
  answer(): ChildBooksResponse {
    const now = this.readBy(this.childId);
    const before = this.atStart.get(this.childId) ?? [];
    const given = now.filter((bookId) => !before.includes(bookId)).reverse();
    const kept = this.ordered(before.filter((bookId) => now.includes(bookId)));
    const books = [
      ...given.map((bookId) => this.book(bookId, true)),
      ...kept.map((bookId) => this.book(bookId, this.drawnNew(bookId))),
    ];
    return { books, newCount: books.filter(({ isNew }) => isNew).length };
  }

  /** The ids of the books the child reads now, in the library's order. */
  private readBy(childId: string): string[] {
    return [...this.library.owned]
      .filter(([, readers]) => readers.includes(childId))
      .map(([bookId]) => bookId);
  }

  /** The books in the order the child was given them; 小明's as the design draws them. */
  private ordered(bookIds: readonly string[]): readonly string[] {
    if (this.childId !== XIAOMING_ID) {
      return bookIds;
    }
    const drawn = XIAOMING_SHELF.map(([bookId]) => bookId);
    const rank = (bookId: string) => {
      const index = drawn.indexOf(bookId);
      return index === -1 ? drawn.length : index;
    };
    return [...bookIds].sort((first, second) => rank(first) - rank(second));
  }

  private drawnNew(bookId: string): boolean {
    return (
      this.childId === XIAOMING_ID &&
      XIAOMING_SHELF.some(([drawn, isNew]) => drawn === bookId && isNew)
    );
  }

  private book(bookId: string, isNew: boolean): ChildBook {
    const { id, title, intro, grade, subject, status, coverUrl } = this.library.card(bookId);
    return { id, title, intro, grade, subject, status, coverUrl, isNew };
  }
}

/**
 * Serves `GET /api/child/books` from the fake library for the child signed
 * in, 小明 unless the test changes `childId`. Returns the shelf.
 */
export function stubChildShelf(library: FakeLibrary): FakeChildShelf {
  const shelf = new FakeChildShelf(library);
  worker.use(http.get('/api/child/books', () => HttpResponse.json(shelf.answer())));
  return shelf;
}

/** Answers `GET /api/child/books` with the books given. */
export function stubChildBooks(response: ChildBooksResponse): void {
  worker.use(http.get('/api/child/books', () => HttpResponse.json(response)));
}
