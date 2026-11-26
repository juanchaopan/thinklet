import type { BookListQuery, ErrorCode } from '@thinklet/contracts';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import type { AuditEvent, AuditService } from '../audit/audit.service.js';
import type { ChildrenService } from '../child/children.service.js';
import { decodeCursor, encodeCursor } from './book-cursor.js';
import {
  BookInUseError,
  ReaderGoneError,
  type BookDetailRecord,
  type BookFilter,
  type BooksRepository,
  type GradeRecord,
  type LibraryBookRecord,
  type NamedRecord,
  type ReaderRecord,
} from './books.repository.js';
import {
  BOOK_BATCH_SIZE,
  LibraryService,
  gradeLevelsOf,
  knownOf,
  planReaders,
  readersByBook,
  replacementOf,
  scopeOf,
} from './library.service.js';

const FAMILY_ID = 'family-1';
const PARENT_ID = 'parent-1';
const XIAOMI = { id: 'child-1', nickname: '小米', account: 'xiaomi' };
const DOUDOU = { id: 'child-2', nickname: '豆豆', account: 'doudou' };
const PRESCHOOL = { id: 'preschool', name: '学前' };
const FIRST_GRADE = { id: 'grade-1', name: '一年级' };
const SECOND_GRADE = { id: 'grade-2', name: '二年级' };
const GRADES: GradeRecord[] = [
  { ...PRESCHOOL, level: 0 },
  { ...FIRST_GRADE, level: 1 },
  { ...SECOND_GRADE, level: 2 },
];
const CHINESE = { id: 'chinese', name: '语文' };
const MATH = { id: 'math', name: '数学' };
const SUBJECTS = [CHINESE, MATH];

/** The transaction the repository double hands its work, which the audit events are written with. */
const TRANSACTION = { transaction: 'books' };

/** Who acted on which book of which family, as every audit event of the service names them. */
const ON_CARROT_COUNTING = {
  actor: { kind: 'parent', id: PARENT_ID },
  targetId: 'carrot-counting',
  familyId: FAMILY_ID,
} as const;

/**
 * The error code the call is refused with. A call that succeeds, or fails
 * with anything but an api error, fails the test.
 */
function refusalOf(call: Promise<unknown> | (() => unknown)): Promise<ErrorCode> {
  const promise = typeof call === 'function' ? Promise.resolve().then(call) : call;
  return promise.then(
    () => {
      throw new Error('The call succeeded');
    },
    (error: unknown) => {
      if (error instanceof ApiError) {
        return error.code;
      }
      throw error;
    },
  );
}

/** A book of the list, the n-th newest, written for preschool to the first grade. */
function listed(index: number, acquired = false): LibraryBookRecord {
  const id = `book-${String(index).padStart(2, '0')}`;
  return {
    id,
    title: `书 ${index}`,
    intro: '简介',
    minGrade: PRESCHOOL,
    maxGrade: FIRST_GRADE,
    subject: MATH,
    status: 'active',
    coverSha256: index % 2 === 0 ? 'a'.repeat(64) : null,
    acquired,
    position: { createdAt: `2026-11-23T07:${String(59 - index).padStart(2, '0')}:00.000000Z`, id },
  };
}

/** A book's page as the repository reads it, of the first grade alone. */
function page(overrides: Partial<BookDetailRecord> = {}): BookDetailRecord {
  return {
    id: 'carrot-counting',
    title: '胡萝卜数数大冒险',
    intro: '简介',
    minGrade: FIRST_GRADE,
    maxGrade: FIRST_GRADE,
    subject: MATH,
    status: 'active',
    coverSha256: null,
    acquired: true,
    replacement: null,
    ...overrides,
  };
}

const query = (overrides: Partial<BookListQuery> = {}): BookListQuery => ({
  grade: [],
  subject: [],
  scope: 'library',
  ...overrides,
});

describe('knownOf', () => {
  it('keeps the records whose ids exist, in the set order, without repeats', () => {
    expect(knownOf(['math', 'nope', 'chinese', 'math'], SUBJECTS)).toEqual(SUBJECTS);
  });

  it('answers no records, meaning all, when none exists', () => {
    expect(knownOf(['nope'], SUBJECTS)).toEqual([]);
  });
});

describe('gradeLevelsOf', () => {
  it('answers the levels of the grades that exist, in the set order, without repeats', () => {
    expect(gradeLevelsOf(['grade-2', 'nope', 'preschool', 'grade-2'], GRADES)).toEqual([0, 2]);
  });

  it('answers no levels, meaning all, when no grade exists', () => {
    expect(gradeLevelsOf(['nope'], GRADES)).toEqual([]);
  });
});

describe('scopeOf', () => {
  const children = [XIAOMI, DOUDOU];

  it.each(['library', 'family'] as const)(
    'answers the %s scope of the family, ignoring a child',
    (scope) => {
      expect(scopeOf(FAMILY_ID, query({ scope, child: XIAOMI.id }), children)).toEqual({
        scope,
        familyId: FAMILY_ID,
      });
    },
  );

  it("answers the child scope of the family's child", () => {
    expect(scopeOf(FAMILY_ID, query({ scope: 'child', child: DOUDOU.id }), children)).toEqual({
      scope: 'child',
      familyId: FAMILY_ID,
      childId: DOUDOU.id,
    });
  });

  it.each([
    ['another child', 'child-9'],
    ['no child', undefined],
  ])('refuses the child scope with %s as child_not_found', async (_case, child) => {
    expect(
      await refusalOf(() => scopeOf(FAMILY_ID, query({ scope: 'child', child }), children)),
    ).toBe('child_not_found');
  });
});

describe('planReaders', () => {
  const family = new Set([XIAOMI.id, DOUDOU.id, 'child-3']);

  it('adds the new children, takes the book from those left out and keeps the rest', () => {
    expect(planReaders('active', [XIAOMI.id, DOUDOU.id], [DOUDOU.id, 'child-3'], family)).toEqual({
      added: ['child-3'],
      removed: [XIAOMI.id],
    });
  });

  it('changes nothing when the readers are as wanted, given in any order and repeated', () => {
    expect(
      planReaders('active', [XIAOMI.id, DOUDOU.id], [DOUDOU.id, XIAOMI.id, DOUDOU.id], family),
    ).toEqual({ added: [], removed: [] });
  });

  it('takes the book from everyone when no child is wanted', () => {
    expect(planReaders('inactive', [XIAOMI.id, DOUDOU.id], [], family)).toEqual({
      added: [],
      removed: [XIAOMI.id, DOUDOU.id],
    });
  });

  it('lets an inactive book keep or lose readers', () => {
    expect(planReaders('inactive', [XIAOMI.id, DOUDOU.id], [XIAOMI.id], family)).toEqual({
      added: [],
      removed: [DOUDOU.id],
    });
  });

  it('refuses a new reader of an inactive book as book_inactive', async () => {
    expect(
      await refusalOf(() => planReaders('inactive', [XIAOMI.id], [XIAOMI.id, DOUDOU.id], family)),
    ).toBe('book_inactive');
  });

  it("refuses a child not the family's as child_not_found, before anything else", async () => {
    expect(await refusalOf(() => planReaders('inactive', [], ['child-9'], family))).toBe(
      'child_not_found',
    );
    expect(
      await refusalOf(() => planReaders('active', [XIAOMI.id], [XIAOMI.id, 'child-9'], family)),
    ).toBe('child_not_found');
  });
});

describe('readersByBook', () => {
  it("answers each book's readers in the order the children were added", () => {
    const readers: ReaderRecord[] = [
      { bookId: 'b', childId: DOUDOU.id },
      { bookId: 'a', childId: DOUDOU.id },
      { bookId: 'a', childId: XIAOMI.id },
    ];

    expect(Object.fromEntries(readersByBook(readers, [XIAOMI, DOUDOU]))).toEqual({
      a: [
        { childId: XIAOMI.id, nickname: '小米' },
        { childId: DOUDOU.id, nickname: '豆豆' },
      ],
      b: [{ childId: DOUDOU.id, nickname: '豆豆' }],
    });
  });

  it('leaves out a reader who is no longer one of the children', () => {
    expect(readersByBook([{ bookId: 'a', childId: 'gone' }], [XIAOMI]).get('a')).toEqual([]);
  });
});

describe('replacementOf', () => {
  const active = { id: 'carrot-counting', title: '胡萝卜数数大冒险', status: 'active' } as const;

  it('answers the active replacement of an inactive book', () => {
    expect(replacementOf(page({ status: 'inactive', replacement: active }))).toEqual({
      id: active.id,
      title: active.title,
    });
  });

  it.each<[string, Partial<BookDetailRecord>]>([
    ['an active book', { replacement: active }],
    ['an inactive book without one', { status: 'inactive' }],
    [
      'an inactive book whose replacement is inactive',
      { status: 'inactive', replacement: { ...active, status: 'inactive' } },
    ],
  ])('answers none for %s', (_case, overrides) => {
    expect(replacementOf(page(overrides))).toBeNull();
  });
});

/**
 * The service over a repository double of one family, which has the
 * books in `acquired` and whose children read the books in `readers`.
 * A transaction runs its work on the same store; `calls` lists the
 * transactions, the locks, the writes and the audit events in order.
 */
function createService(
  options: {
    rows?: LibraryBookRecord[];
    status?: 'active' | 'inactive' | undefined;
    acquired?: boolean;
    readers?: string[];
    detail?: BookDetailRecord | undefined;
  } = {},
) {
  const calls: string[] = [];
  const store = {
    listGrades: vi.fn(() => Promise.resolve(GRADES)),
    listSubjects: vi.fn(() => Promise.resolve(SUBJECTS)),
    listSubjectsWithBooks: vi.fn<(filter: BookFilter) => Promise<NamedRecord[]>>(() =>
      Promise.resolve([MATH]),
    ),
    listBooks: vi.fn((_filter: BookFilter, _position: unknown, limit: number) =>
      Promise.resolve((options.rows ?? []).slice(0, limit)),
    ),
    listReaders: vi.fn((_familyId: string, bookIds: readonly string[]): Promise<ReaderRecord[]> =>
      Promise.resolve(
        bookIds.flatMap((bookId) =>
          (options.readers ?? []).map((childId) => ({ bookId, childId })),
        ),
      ),
    ),
    findBook: vi.fn(() => Promise.resolve('detail' in options ? options.detail : page())),
    findStatus: vi.fn(() => Promise.resolve('status' in options ? options.status : 'active')),
    isAcquired: vi.fn(() => Promise.resolve(options.acquired ?? false)),
    insertFamilyBook: vi.fn(() => {
      calls.push('insertFamilyBook');
      return Promise.resolve(!(options.acquired ?? false));
    }),
    lockFamilyBook: vi.fn(() => {
      calls.push('lockFamilyBook');
      return Promise.resolve(options.acquired ?? true);
    }),
    readerIds: vi.fn(() => Promise.resolve(options.readers ?? [])),
    deleteFamilyBook: vi.fn(() => {
      calls.push('deleteFamilyBook');
      return Promise.resolve();
    }),
    deleteAssignments: vi.fn((_familyId: string, _bookId: string, childIds: readonly string[]) => {
      calls.push(`deleteAssignments ${childIds.join(',')}`);
      return Promise.resolve();
    }),
    insertAssignments: vi.fn((_familyId: string, _bookId: string, childIds: readonly string[]) => {
      calls.push(`insertAssignments ${childIds.join(',')}`);
      return Promise.resolve();
    }),
  };
  const repository = {
    ...store,
    transaction: vi.fn(
      async (work: (transactionStore: typeof store, transaction: unknown) => Promise<unknown>) => {
        calls.push('transaction');
        return work(store, TRANSACTION);
      },
    ),
  };
  const children = { list: vi.fn(() => Promise.resolve([XIAOMI, DOUDOU])) };
  const audit = {
    record: vi.fn((_transaction: unknown, event: AuditEvent) => {
      calls.push(`audit ${event.action}`);
      return Promise.resolve();
    }),
  };
  const service = new LibraryService(
    repository as unknown as BooksRepository,
    children as unknown as ChildrenService,
    audit as unknown as AuditService,
  );
  return { service, store, audit, calls };
}

describe('LibraryService', () => {
  describe('list', () => {
    it('answers a batch of 12 with the cursor of its last book when more follow', async () => {
      const rows = Array.from({ length: 20 }, (_, index) => listed(index));
      const { service, store } = createService({ rows });

      const batch = await service.list(FAMILY_ID, query());

      expect(store.listBooks).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        BOOK_BATCH_SIZE + 1,
      );
      expect(batch.books.map(({ id }) => id)).toEqual(rows.slice(0, 12).map(({ id }) => id));
      expect(decodeCursor(batch.nextCursor ?? '')).toEqual(rows[11]?.position);
    });

    it('answers no cursor when the batch holds the last books', async () => {
      const { service } = createService({
        rows: Array.from({ length: 12 }, (_, index) => listed(index)),
      });

      expect((await service.list(FAMILY_ID, query())).nextCursor).toBeNull();
    });

    it("reads on from the cursor's position", async () => {
      const position = { createdAt: '2026-11-23T07:46:00.000000Z', id: 'carrot-counting' };
      const { service, store } = createService();

      await service.list(FAMILY_ID, query({ cursor: encodeCursor(position) }));

      expect(store.listBooks).toHaveBeenCalledWith(
        expect.anything(),
        position,
        BOOK_BATCH_SIZE + 1,
      );
    });

    it('refuses a cursor it did not make with the field cursor, before any lookup', async () => {
      const { service, store } = createService();

      await expect(service.list(FAMILY_ID, query({ cursor: 'forged' }))).rejects.toMatchObject({
        code: 'invalid_request',
        fields: [{ path: 'cursor', code: 'invalid' }],
      });
      expect(store.listBooks).not.toHaveBeenCalled();
    });

    it('filters by the levels of the grades and the subjects that exist and by the scope', async () => {
      const { service, store } = createService();

      await service.list(
        FAMILY_ID,
        query({
          grade: ['grade-2', 'nope', 'grade-1'],
          subject: ['nope'],
          scope: 'child',
          child: DOUDOU.id,
        }),
      );

      expect(store.listBooks).toHaveBeenCalledWith(
        {
          scope: 'child',
          familyId: FAMILY_ID,
          childId: DOUDOU.id,
          gradeLevels: [1, 2],
          subjectIds: [],
        },
        undefined,
        BOOK_BATCH_SIZE + 1,
      );
    });

    it('looks up no grades or subjects when the query does not filter by them', async () => {
      const { service, store } = createService();

      await service.list(FAMILY_ID, query());

      expect(store.listGrades).not.toHaveBeenCalled();
      expect(store.listSubjects).not.toHaveBeenCalled();
      expect(store.listBooks).toHaveBeenCalledWith(
        { scope: 'library', familyId: FAMILY_ID, gradeLevels: [], subjectIds: [] },
        undefined,
        BOOK_BATCH_SIZE + 1,
      );
    });

    it('answers the cards with their range of grades, covers and the readers of the books the family has', async () => {
      const { service, store } = createService({
        rows: [listed(0, true), listed(1)],
        readers: [DOUDOU.id, XIAOMI.id],
      });

      const { books } = await service.list(FAMILY_ID, query());

      expect(store.listReaders).toHaveBeenCalledWith(FAMILY_ID, ['book-00']);
      expect(books).toEqual([
        {
          id: 'book-00',
          title: '书 0',
          intro: '简介',
          minGrade: PRESCHOOL,
          maxGrade: FIRST_GRADE,
          subject: MATH,
          status: 'active',
          coverUrl: `/api/books/book-00/cover?v=${'a'.repeat(64)}`,
          acquired: true,
          readers: [
            { childId: XIAOMI.id, nickname: '小米' },
            { childId: DOUDOU.id, nickname: '豆豆' },
          ],
        },
        expect.objectContaining({ id: 'book-01', coverUrl: null, acquired: false, readers: [] }),
      ]);
    });
  });

  it('answers every grade by its id and name, and the subjects with books covering the grades of the scope', async () => {
    const { service, store } = createService();

    const filters = await service.filters(
      FAMILY_ID,
      query({ grade: ['preschool', 'nope'], scope: 'family' }),
    );

    expect(filters).toEqual({
      grades: [PRESCHOOL, FIRST_GRADE, SECOND_GRADE],
      subjects: [MATH],
    });
    expect(store.listSubjectsWithBooks).toHaveBeenCalledWith({
      scope: 'family',
      familyId: FAMILY_ID,
      gradeLevels: [0],
    });
  });

  describe('detail', () => {
    it('answers the book with its range of grades, its readers and its replacement', async () => {
      const { service } = createService({ readers: [XIAOMI.id] });

      expect(await service.detail(FAMILY_ID, 'carrot-counting')).toMatchObject({
        minGrade: FIRST_GRADE,
        maxGrade: FIRST_GRADE,
        acquired: true,
        readers: [{ childId: XIAOMI.id, nickname: '小米' }],
        replacement: null,
      });
    });

    it('answers a book the family does not have without asking for readers', async () => {
      const { service, store } = createService({ detail: page({ acquired: false }) });

      expect((await service.detail(FAMILY_ID, 'carrot-counting')).readers).toEqual([]);
      expect(store.listReaders).not.toHaveBeenCalled();
    });

    it.each<[string, BookDetailRecord | undefined]>([
      ['a missing book', undefined],
      ['an inactive book the family does not have', page({ status: 'inactive', acquired: false })],
    ])('refuses %s as book_not_found', async (_case, detail) => {
      const { service } = createService({ detail });

      expect(await refusalOf(service.detail(FAMILY_ID, 'carrot-counting'))).toBe('book_not_found');
    });
  });

  describe('acquire', () => {
    it('records an active book for the family and its audit event, then answers it', async () => {
      const { service, store, audit, calls } = createService();

      expect(await service.acquire(PARENT_ID, FAMILY_ID, 'carrot-counting')).toMatchObject({
        acquired: true,
      });
      expect(store.insertFamilyBook).toHaveBeenCalledWith(FAMILY_ID, 'carrot-counting');
      expect(calls).toEqual(['transaction', 'insertFamilyBook', 'audit book.acquired']);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_CARROT_COUNTING,
        action: 'book.acquired',
      });
    });

    it('records nothing for an active book the family has already', async () => {
      const { service, audit } = createService({ acquired: true });

      await service.acquire(PARENT_ID, FAMILY_ID, 'carrot-counting');

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers an inactive book the family has without writing', async () => {
      const { service, store, audit } = createService({
        status: 'inactive',
        acquired: true,
        detail: page({ status: 'inactive' }),
      });

      await service.acquire(PARENT_ID, FAMILY_ID, 'bunny-counts');

      expect(store.insertFamilyBook).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each<[string, 'inactive' | undefined, ErrorCode]>([
      ['an inactive book the family does not have', 'inactive', 'book_inactive'],
      ['a missing book', undefined, 'book_not_found'],
    ])('refuses %s', async (_case, status, code) => {
      const { service, store, audit } = createService({ status, acquired: false });

      expect(await refusalOf(service.acquire(PARENT_ID, FAMILY_ID, 'x'))).toBe(code);
      expect(store.insertFamilyBook).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it("removes a book no child reads under the family book's lock and records it", async () => {
      const { service, audit, calls } = createService();

      await service.remove(PARENT_ID, FAMILY_ID, 'carrot-counting');

      expect(calls).toEqual([
        'transaction',
        'lockFamilyBook',
        'deleteFamilyBook',
        'audit book.removed',
      ]);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_CARROT_COUNTING,
        action: 'book.removed',
      });
    });

    it('does nothing for a book the family does not have', async () => {
      const { service, calls } = createService({ acquired: false });

      await service.remove(PARENT_ID, FAMILY_ID, 'carrot-counting');

      expect(calls).toEqual(['transaction', 'lockFamilyBook']);
    });

    it('refuses a book a child reads as book_in_use', async () => {
      const { service, audit, calls } = createService({ readers: [XIAOMI.id] });

      expect(await refusalOf(service.remove(PARENT_ID, FAMILY_ID, 'carrot-counting'))).toBe(
        'book_in_use',
      );
      expect(calls).not.toContain('deleteFamilyBook');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("answers the assignments' key refusing the removal as book_in_use", async () => {
      const { service, store } = createService();
      store.deleteFamilyBook.mockRejectedValueOnce(new BookInUseError());

      expect(await refusalOf(service.remove(PARENT_ID, FAMILY_ID, 'carrot-counting'))).toBe(
        'book_in_use',
      );
    });

    it('passes on any other failure', async () => {
      const { service, store } = createService();
      const failure = new Error('connection lost');
      store.deleteFamilyBook.mockRejectedValueOnce(failure);

      await expect(service.remove(PARENT_ID, FAMILY_ID, 'carrot-counting')).rejects.toBe(failure);
    });

    it('refuses a missing book as book_not_found', async () => {
      const { service } = createService({ status: undefined });

      expect(await refusalOf(service.remove(PARENT_ID, FAMILY_ID, 'x'))).toBe('book_not_found');
    });
  });

  describe('setReaders', () => {
    it("takes the book away and assigns it under the family book's lock, records both, then answers it", async () => {
      const { service, audit, calls, store } = createService({ readers: [XIAOMI.id] });

      await service.setReaders(PARENT_ID, FAMILY_ID, 'carrot-counting', [DOUDOU.id]);

      expect(calls).toEqual([
        'transaction',
        'lockFamilyBook',
        `deleteAssignments ${XIAOMI.id}`,
        `insertAssignments ${DOUDOU.id}`,
        'audit book.readers_changed',
      ]);
      expect(store.insertAssignments).toHaveBeenCalledWith(FAMILY_ID, 'carrot-counting', [
        DOUDOU.id,
      ]);
      expect(audit.record).toHaveBeenCalledWith(TRANSACTION, {
        ...ON_CARROT_COUNTING,
        action: 'book.readers_changed',
        details: { added: [DOUDOU.id], removed: [XIAOMI.id] },
      });
      expect(store.findBook).toHaveBeenCalled();
    });

    it('writes and records nothing when the readers are as wanted already', async () => {
      const { service, audit, calls } = createService({ readers: [XIAOMI.id] });

      await service.setReaders(PARENT_ID, FAMILY_ID, 'carrot-counting', [XIAOMI.id]);

      expect(calls).toEqual(['transaction', 'lockFamilyBook']);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each<[string, Parameters<typeof createService>[0], string[], ErrorCode]>([
      ['a book the family does not have', { acquired: false }, [XIAOMI.id], 'book_not_acquired'],
      ['a missing book', { status: undefined }, [XIAOMI.id], 'book_not_found'],
      ['a child of another family', {}, ['child-9'], 'child_not_found'],
      ['a new reader of an inactive book', { status: 'inactive' }, [XIAOMI.id], 'book_inactive'],
    ])('refuses %s and writes nothing', async (_case, options, childIds, code) => {
      const { service, store, audit } = createService(options);

      expect(await refusalOf(service.setReaders(PARENT_ID, FAMILY_ID, 'x', childIds))).toBe(code);
      expect(store.deleteAssignments).not.toHaveBeenCalled();
      expect(store.insertAssignments).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('answers a child deleted meanwhile as child_not_found', async () => {
      const { service, store } = createService();
      store.insertAssignments.mockRejectedValueOnce(new ReaderGoneError());

      expect(await refusalOf(service.setReaders(PARENT_ID, FAMILY_ID, 'x', [XIAOMI.id]))).toBe(
        'child_not_found',
      );
    });

    it('passes on any other failure', async () => {
      const { service, store } = createService();
      const failure = new Error('connection lost');
      store.insertAssignments.mockRejectedValueOnce(failure);

      await expect(service.setReaders(PARENT_ID, FAMILY_ID, 'x', [XIAOMI.id])).rejects.toBe(
        failure,
      );
    });
  });
});
