import * as z from 'zod';
import './runtime.js';
import { idSchema } from './fields.js';

/** A book id: 1 to 60 lower-case letters, digits and hyphens. */
const BOOK_ID_PATTERN = /^[a-z0-9-]{1,60}$/;

/** The id of a book, as in its address and its cover folder `content/books/<id>/`. */
export const bookIdSchema = z
  .string({ error: 'invalid' })
  .regex(BOOK_ID_PATTERN, { error: 'invalid' });

/** A grade as books and the filters name it. */
export const gradeRefSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
});

/** A subject as books and the filters name it. */
export const subjectRefSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
});

/** Whether a book is in the library (`active`) or has left it (`inactive`). */
export const bookStatusSchema = z.enum(['active', 'inactive']);

/** Where the library lists books from: the whole library, the family's books or one child's. */
export const bookScopeSchema = z.enum(['library', 'family', 'child']);

/** A child of the family who reads a book. */
export const bookReaderSchema = z.strictObject({
  childId: z.uuid(),
  nickname: z.string(),
});

/**
 * What every view of a book shows. `minGrade` and `maxGrade` are the
 * lowest and highest grades the book is written for, both the same grade
 * for a book of one grade; the grade the book teaches at stays with the
 * api and is never shown. `coverUrl` carries the cover's SHA-256, so it
 * changes with the cover; null when the book has no cover yet and the
 * default cover is shown.
 */
const bookSummaryShape = {
  id: bookIdSchema,
  title: z.string(),
  intro: z.string(),
  minGrade: gradeRefSchema,
  maxGrade: gradeRefSchema,
  subject: subjectRefSchema,
  status: bookStatusSchema,
  coverUrl: z.string().nullable(),
};

/**
 * A book in the library list, as a family's parents see it. `readers` are
 * the children reading it, in the order they were added; empty when the
 * family has not acquired the book.
 */
export const bookCardSchema = z.strictObject({
  ...bookSummaryShape,
  acquired: z.boolean(),
  readers: z.array(bookReaderSchema),
});

/** The book that takes an inactive book's place. */
export const bookReplacementSchema = z.strictObject({
  id: bookIdSchema,
  title: z.string(),
});

/**
 * Response body of `GET /api/families/{familyId}/books/{bookId}`, and of
 * acquiring a book and setting its readers. `replacement` is set only for
 * an inactive book whose replacement is active.
 */
export const bookDetailSchema = z.strictObject({
  ...bookCardSchema.shape,
  replacement: bookReplacementSchema.nullable(),
});

/** Response body of `GET /api/families/{familyId}/books`; `nextCursor` is null after the last batch. */
export const bookListResponseSchema = z.strictObject({
  books: z.array(bookCardSchema),
  nextCursor: z.string().nullable(),
});

/**
 * Response body of `GET /api/families/{familyId}/book-filters`: every
 * grade, and the subjects that have books for the grades and scope asked
 * for, both in their set order.
 */
export const bookFiltersResponseSchema = z.strictObject({
  grades: z.array(gradeRefSchema),
  subjects: z.array(subjectRefSchema),
});

/**
 * A query parameter that may be given several times: none, one or more
 * values, as a list without repeats. Ids that do not exist are left to the
 * api to ignore.
 */
const repeatedParameterSchema = z
  .union([z.string(), z.array(z.string())], { error: 'invalid' })
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return [];
    }
    return [...new Set(typeof value === 'string' ? [value] : value)];
  });

/** The `child` scope lists one child's books, so it needs `child`. */
function requireChildOfScope(
  query: { scope: z.infer<typeof bookScopeSchema>; child?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (query.scope === 'child' && query.child === undefined) {
    context.addIssue({ code: 'custom', path: ['child'], message: 'required' });
  }
}

/** The filters the library list and its filter options share. */
const bookFilterShape = {
  grade: repeatedParameterSchema,
  scope: bookScopeSchema.default('library'),
  child: idSchema.optional(),
};

/**
 * Query of `GET /api/families/{familyId}/books`. `grade` and `subject` may
 * repeat, and a filter left out takes in every grade or subject; a book
 * matches the grades when any of them lies within its range. `cursor` is
 * the opaque position of the next batch, decoded and checked by the api.
 * Other parameters are ignored.
 */
export const bookListQuerySchema = z
  .object({
    ...bookFilterShape,
    subject: repeatedParameterSchema,
    cursor: z.string({ error: 'invalid' }).min(1, { error: 'invalid' }).optional(),
  })
  .superRefine(requireChildOfScope);

/** Query of `GET /api/families/{familyId}/book-filters`; other parameters are ignored. */
export const bookFiltersQuerySchema = z.object(bookFilterShape).superRefine(requireChildOfScope);

/**
 * Request body of `PUT /api/families/{familyId}/books/{bookId}/readers`:
 * every child who reads the book afterwards, none to take it from all.
 */
export const setBookReadersRequestSchema = z.strictObject({
  childIds: z.array(idSchema, {
    error: (issue) => (issue.input === undefined ? 'required' : 'invalid'),
  }),
});

/** A book assigned to the signed-in child; `isNew` until the child first opens it. */
export const childBookSchema = z.strictObject({
  ...bookSummaryShape,
  isNew: z.boolean(),
});

/**
 * Response body of `GET /api/child/books`: every book assigned to the
 * child, latest assignment first, and how many of them are new.
 */
export const childBooksResponseSchema = z.strictObject({
  books: z.array(childBookSchema),
  newCount: z.int().nonnegative(),
});

export type GradeRef = z.infer<typeof gradeRefSchema>;
export type SubjectRef = z.infer<typeof subjectRefSchema>;
export type BookStatus = z.infer<typeof bookStatusSchema>;
export type BookScope = z.infer<typeof bookScopeSchema>;
export type BookReader = z.infer<typeof bookReaderSchema>;
export type BookCard = z.infer<typeof bookCardSchema>;
export type BookReplacement = z.infer<typeof bookReplacementSchema>;
export type BookDetail = z.infer<typeof bookDetailSchema>;
export type BookListResponse = z.infer<typeof bookListResponseSchema>;
export type BookFiltersResponse = z.infer<typeof bookFiltersResponseSchema>;
export type BookListQuery = z.infer<typeof bookListQuerySchema>;
export type BookFiltersQuery = z.infer<typeof bookFiltersQuerySchema>;
export type SetBookReadersRequest = z.infer<typeof setBookReadersRequestSchema>;
export type ChildBook = z.infer<typeof childBookSchema>;
export type ChildBooksResponse = z.infer<typeof childBooksResponseSchema>;
