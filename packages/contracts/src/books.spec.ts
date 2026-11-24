import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  bookDetailSchema,
  bookFiltersQuerySchema,
  bookFiltersResponseSchema,
  bookIdSchema,
  bookListQuerySchema,
  bookListResponseSchema,
  childBooksResponseSchema,
  setBookReadersRequestSchema,
} from './books.js';
import { toFieldErrors } from './errors.js';

const childId = '3f9b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** The field errors a value is rejected with; empty when it is accepted. */
function fieldErrorsOf(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? [] : toFieldErrors(result.error);
}

/** What every view shows of a book. */
const book = {
  id: 'carrot-counting',
  title: '胡萝卜数数大冒险',
  intro: '小兔要把 20 根胡萝卜分给朋友们。',
  grade: { id: 'grade-1', name: '一年级' },
  subject: { id: 'math', name: '数学' },
  status: 'active',
  coverUrl: `/api/books/carrot-counting/cover?v=${'9f2c'.repeat(16)}`,
};

/** The book as a family's parents see it in the library. */
const card = { ...book, acquired: true, readers: [{ childId, nickname: '小米' }] };

describe('bookIdSchema', () => {
  it('accepts lower-case letters, digits and hyphens up to 60 characters', () => {
    for (const id of ['carrot-counting', 'grade-1', 'a', 'b'.repeat(60)]) {
      expect(bookIdSchema.safeParse(id).success, id).toBe(true);
    }
  });

  it('rejects other characters, an empty id and a longer one', () => {
    for (const id of [
      'Carrot',
      'carrot_counting',
      'carrot counting',
      '../cover',
      '',
      'b'.repeat(61),
    ]) {
      expect(bookIdSchema.safeParse(id).success, id).toBe(false);
    }
  });
});

describe('bookListQuerySchema', () => {
  it('takes the whole library when nothing is given', () => {
    expect(bookListQuerySchema.parse({})).toEqual({ grade: [], subject: [], scope: 'library' });
  });

  it('takes a repeated grade or subject as a list, without repeats', () => {
    expect(
      bookListQuerySchema.parse({
        grade: ['grade-1', 'grade-2', 'grade-1'],
        subject: 'math',
        scope: 'family',
        cursor: 'opaque',
      }),
    ).toEqual({
      grade: ['grade-1', 'grade-2'],
      subject: ['math'],
      scope: 'family',
      cursor: 'opaque',
    });
  });

  it('needs the child of the child scope', () => {
    expect(bookListQuerySchema.parse({ scope: 'child', child: childId })).toMatchObject({
      scope: 'child',
      child: childId,
    });
    expect(fieldErrorsOf(bookListQuerySchema, { scope: 'child' })).toEqual([
      { path: 'child', code: 'required' },
    ]);
  });

  it('rejects an unknown scope, a child that is not an id and a repeated or empty cursor', () => {
    expect(fieldErrorsOf(bookListQuerySchema, { scope: 'school' })).toEqual([
      { path: 'scope', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(bookListQuerySchema, { scope: 'child', child: 'xiaomi' })).toEqual([
      { path: 'child', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(bookListQuerySchema, { cursor: ['a', 'b'] })).toEqual([
      { path: 'cursor', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(bookListQuerySchema, { cursor: '' })).toEqual([
      { path: 'cursor', code: 'invalid' },
    ]);
  });

  it('ignores other parameters', () => {
    expect(bookListQuerySchema.parse({ page: '2' })).toEqual({
      grade: [],
      subject: [],
      scope: 'library',
    });
  });
});

describe('bookFiltersQuerySchema', () => {
  it('takes the grades and the scope, with the child of the child scope', () => {
    expect(
      bookFiltersQuerySchema.parse({ grade: 'preschool', scope: 'child', child: childId }),
    ).toEqual({ grade: ['preschool'], scope: 'child', child: childId });
    expect(fieldErrorsOf(bookFiltersQuerySchema, { scope: 'child' })).toEqual([
      { path: 'child', code: 'required' },
    ]);
  });

  it('has no subject filter or cursor', () => {
    expect(bookFiltersQuerySchema.parse({ subject: 'math', cursor: 'opaque' })).toEqual({
      grade: [],
      scope: 'library',
    });
  });
});

describe('bookListResponseSchema', () => {
  it('accepts a batch of books with the cursor of the next one', () => {
    const body = { books: [card], nextCursor: 'opaque' };

    expect(bookListResponseSchema.parse(body)).toEqual(body);
  });

  it('accepts the last batch and a book without a cover, readers or the family', () => {
    const body = {
      books: [{ ...card, coverUrl: null, acquired: false, readers: [] }],
      nextCursor: null,
    };

    expect(bookListResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects an unknown status and other keys', () => {
    expect(
      bookListResponseSchema.safeParse({
        books: [{ ...card, status: 'retired' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      bookListResponseSchema.safeParse({
        books: [{ ...card, coverSha256: 'ab' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('bookDetailSchema', () => {
  it('accepts a book with its replacement or without one', () => {
    const inactive = {
      ...card,
      id: 'bunny-counts',
      status: 'inactive',
      replacement: { id: 'carrot-counting', title: '胡萝卜数数大冒险' },
    };

    expect(bookDetailSchema.parse(inactive)).toEqual(inactive);
    expect(bookDetailSchema.parse({ ...card, replacement: null })).toMatchObject({
      replacement: null,
    });
  });

  it('needs the replacement, null included', () => {
    expect(bookDetailSchema.safeParse(card).success).toBe(false);
  });
});

describe('bookFiltersResponseSchema', () => {
  it('accepts the grades and subjects', () => {
    const body = {
      grades: [{ id: 'preschool', name: '学前' }],
      subjects: [{ id: 'math', name: '数学' }],
    };

    expect(bookFiltersResponseSchema.parse(body)).toEqual(body);
  });
});

describe('setBookReadersRequestSchema', () => {
  it('accepts the children who read the book, none included', () => {
    expect(setBookReadersRequestSchema.parse({ childIds: [childId] })).toEqual({
      childIds: [childId],
    });
    expect(setBookReadersRequestSchema.parse({ childIds: [] })).toEqual({ childIds: [] });
  });

  it('rejects a missing list, ids that are not ids and other keys', () => {
    expect(fieldErrorsOf(setBookReadersRequestSchema, {})).toEqual([
      { path: 'childIds', code: 'required' },
    ]);
    expect(fieldErrorsOf(setBookReadersRequestSchema, { childIds: childId })).toEqual([
      { path: 'childIds', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(setBookReadersRequestSchema, { childIds: ['xiaomi'] })).toEqual([
      { path: 'childIds.0', code: 'invalid' },
    ]);
    expect(fieldErrorsOf(setBookReadersRequestSchema, { childIds: [], all: true })).toEqual([
      { path: '', code: 'invalid' },
    ]);
  });
});

describe('childBooksResponseSchema', () => {
  it('accepts the child books with which of them are new and how many', () => {
    const body = { books: [{ ...book, isNew: true }], newCount: 1 };

    expect(childBooksResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects the family's readers on a child's book and a count that is not a whole number", () => {
    expect(
      childBooksResponseSchema.safeParse({
        books: [{ ...book, readers: card.readers, isNew: true }],
        newCount: 1,
      }).success,
    ).toBe(false);
    expect(childBooksResponseSchema.safeParse({ books: [], newCount: 0.5 }).success).toBe(false);
    expect(childBooksResponseSchema.safeParse({ books: [], newCount: -1 }).success).toBe(false);
  });
});
