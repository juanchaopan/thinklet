import type { BooksRepository, ChildBookRecord } from './books.repository.js';
import { ChildBooksService } from './child-books.service.js';

/** A book assigned to the child, opened at the given time or not yet. */
function assigned(id: string, openedAt: Date | null): ChildBookRecord {
  return {
    id,
    title: `书 ${id}`,
    intro: '简介',
    grade: { id: 'grade-1', name: '一年级' },
    subject: { id: 'math', name: '数学' },
    status: 'active',
    coverSha256: id === 'with-cover' ? 'c'.repeat(64) : null,
    openedAt,
  };
}

describe('ChildBooksService', () => {
  it("answers the child's books in the repository's order, the unopened ones new, and counts them", async () => {
    const listChildBooks = vi.fn(() =>
      Promise.resolve([
        assigned('with-cover', null),
        assigned('opened', new Date('2026-11-23T08:00:00Z')),
        assigned('new', null),
      ]),
    );
    const service = new ChildBooksService({ listChildBooks } as unknown as BooksRepository);

    const { books, newCount } = await service.books('child-1');

    expect(listChildBooks).toHaveBeenCalledWith('child-1');
    expect(books.map(({ id, isNew, coverUrl }) => ({ id, isNew, coverUrl }))).toEqual([
      {
        id: 'with-cover',
        isNew: true,
        coverUrl: `/api/books/with-cover/cover?v=${'c'.repeat(64)}`,
      },
      { id: 'opened', isNew: false, coverUrl: null },
      { id: 'new', isNew: true, coverUrl: null },
    ]);
    expect(newCount).toBe(2);
  });

  it('answers no books and no new ones for a child without books', async () => {
    const service = new ChildBooksService({
      listChildBooks: () => Promise.resolve([]),
    } as unknown as BooksRepository);

    expect(await service.books('child-1')).toEqual({ books: [], newCount: 0 });
  });
});
