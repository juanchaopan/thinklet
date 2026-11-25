import {
  bookDetailSchema,
  bookFiltersResponseSchema,
  bookListResponseSchema,
  type BookCard,
  type BookListResponse,
  type Child,
  type FamilyDetail,
} from '@thinklet/contracts';
import {
  ACTIVE_BOOK,
  INACTIVE_BOOK,
  acquire,
  bookIdsInOrder,
  bookPath,
  booksPath,
  filtersPath,
  insertAssignment,
  insertBook,
  insertFamilyBook,
  insertGrade,
  insertSubject,
  setReaders,
} from '../support/books.js';
import { addChild } from '../support/children.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

const COVER_URL = /^\/api\/books\/[a-z0-9-]+\/cover\?v=[0-9a-f]{64}$/;

/** The subjects of the sample books, in their set order. */
const SAMPLE_SUBJECTS = ['chinese', 'math', 'english', 'science', 'coding'];

type Parameters = Record<string, string | string[] | undefined>;

/** The query string of the parameters, each value of a list as its own parameter. */
function queryOf(parameters: Parameters): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    for (const item of value === undefined ? [] : [value].flat()) {
      search.append(name, item);
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/** A cursor written the way the api writes one, from a time and a book id. */
const cursorOf = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

// Acceptance criteria covered: a parent of the family sees the library 12
// books at a time, newest first, and loads the next batch until all are
// there, without repeats or gaps; filters by several grades and subjects
// and by the library, the family's books or one child's books, inactive
// books only in the last two; the subject options follow the grades and
// the scope; a book's page shows whether the family has it, who reads it
// in the order the children were added and, for an inactive book, the
// active book that replaces it.
describe('library', () => {
  const running = useAppWithServices();
  let admin: Parent;
  let member: Parent;
  let family: FamilyDetail;
  let xiaomi: Child;
  let doudou: Child;

  const asMember = () => as(running.server, member);
  const activeBooks = () => bookIdsInOrder(running.databaseUrl, "status = 'active'");

  /** A new family of the admin, with the member in it. */
  async function newFamily(): Promise<FamilyDetail> {
    const created = await createFamily(running.server, admin);
    await addMember(running.databaseUrl, created.id, member.id);
    return created;
  }

  /** One batch of the family's library with the parameters. */
  async function batchOf(familyId: string, parameters: Parameters = {}): Promise<BookListResponse> {
    const response = await asMember().get(`${booksPath(familyId)}${queryOf(parameters)}`);
    expect(response.status).toBe(200);
    return bookListResponseSchema.parse(response.body);
  }

  /** Every book of the family's library with the parameters, batch by batch, and the batch sizes. */
  async function everyBatch(
    familyId: string,
    parameters: Parameters = {},
  ): Promise<{ ids: string[]; sizes: number[] }> {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const batch = await batchOf(familyId, { ...parameters, cursor });
      ids.push(...batch.books.map(({ id }) => id));
      sizes.push(batch.books.length);
      cursor = batch.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return { ids, sizes };
  }

  beforeAll(async () => {
    [admin, member] = await Promise.all([
      signInParent(running.server, { name: '林悦' }),
      signInParent(running.server, { name: '周子航' }),
    ]);
    family = await newFamily();
    xiaomi = await addChild(running.server, admin, family.id, { nickname: '小米' });
    doudou = await addChild(running.server, admin, family.id, { nickname: '豆豆' });
  });

  describe('the list', () => {
    it('answers the 12 newest active books first, as cards of a family that has none of them', async () => {
      const newest = (await activeBooks()).slice(0, 12);

      const batch = await batchOf((await newFamily()).id);

      expect(batch.books.map(({ id }) => id)).toEqual(newest);
      expect(batch.nextCursor).toEqual(expect.any(String));
      for (const book of batch.books) {
        expect(book).toMatchObject({ status: 'active', acquired: false, readers: [] });
        expect(book.coverUrl).toMatch(COVER_URL);
      }
    });

    it('answers a card with the grade, subject and cover of the book table', async () => {
      const [row] = await query<{ title: string; intro: string; cover_sha256: string }>(
        running.databaseUrl,
        'select title, intro, cover_sha256 from books where id = $1',
        [ACTIVE_BOOK],
      );

      const batch = await batchOf((await newFamily()).id, { grade: 'grade-1', subject: 'math' });

      expect(batch.books.find(({ id }) => id === ACTIVE_BOOK)).toEqual({
        id: ACTIVE_BOOK,
        title: row?.title,
        intro: row?.intro,
        grade: { id: 'grade-1', name: '一年级' },
        subject: { id: 'math', name: '数学' },
        status: 'active',
        coverUrl: `/api/books/${ACTIVE_BOOK}/cover?v=${row?.cover_sha256}`,
        acquired: false,
        readers: [],
      });
    });

    it('loads every active book once, batch after batch, and ends with no cursor', async () => {
      const active = await activeBooks();

      const { ids, sizes } = await everyBatch(family.id);

      expect(ids).toEqual(active);
      expect(ids).not.toContain(INACTIVE_BOOK);
      expect(sizes.slice(0, -1).every((size) => size === 12)).toBe(true);
    });

    it('orders books added at the same time by id and keeps microseconds apart across batches', async () => {
      const gradeId = await insertGrade(running.databaseUrl);
      const subjectId = await insertSubject(running.databaseUrl);
      const tied = await Promise.all(
        Array.from({ length: 14 }, (_, index) =>
          insertBook(running.databaseUrl, {
            id: `tied-${String(index).padStart(2, '0')}-${gradeId}`,
            gradeId,
            subjectId,
            createdAt: '2021-06-01 08:00:00.123456+00',
          }),
        ),
      );
      const later = await insertBook(running.databaseUrl, {
        gradeId,
        subjectId,
        createdAt: '2021-06-01 08:00:00.123457+00',
      });
      const earlier = await insertBook(running.databaseUrl, {
        gradeId,
        subjectId,
        createdAt: '2021-06-01 08:00:00.123455+00',
      });

      const { ids, sizes } = await everyBatch(family.id, { grade: gradeId });

      expect(ids).toEqual([later, ...[...tied].sort(), earlier]);
      expect(sizes).toEqual([12, 4]);
    });

    it('answers a filter with no books with an empty batch and no cursor', async () => {
      const gradeId = await insertGrade(running.databaseUrl);

      expect(await batchOf(family.id, { grade: gradeId })).toEqual({ books: [], nextCursor: null });
    });

    it('keeps the books of any of the grades and any of the subjects asked for', async () => {
      const expected = await bookIdsInOrder(
        running.databaseUrl,
        "status = 'active' and grade_id in ('grade-1', 'preschool') and subject_id in ('math', 'english')",
      );

      const { ids } = await everyBatch(family.id, {
        grade: ['grade-1', 'preschool'],
        subject: ['math', 'english'],
      });

      expect(ids).toEqual(expected);
      expect(ids.length).toBeGreaterThan(1);
    });

    it('ignores grades and subjects that do not exist', async () => {
      const all = await batchOf(family.id);
      const firstGrade = await batchOf(family.id, { grade: 'grade-1' });

      expect(await batchOf(family.id, { grade: 'no-such-grade', subject: 'nope' })).toEqual(all);
      expect(await batchOf(family.id, { grade: ['grade-1', 'no-such-grade'] })).toEqual(firstGrade);
    });

    it("lists the family's books in the family scope, the inactive ones too", async () => {
      const ours = await newFamily();
      await acquire(running.server, admin, ours.id, ACTIVE_BOOK);
      await insertFamilyBook(running.databaseUrl, ours.id, INACTIVE_BOOK);
      const expected = await bookIdsInOrder(
        running.databaseUrl,
        `id in ('${ACTIVE_BOOK}', '${INACTIVE_BOOK}')`,
      );

      const batch = await batchOf(ours.id, { scope: 'family' });

      expect(batch.books.map(({ id, status, acquired }) => ({ id, status, acquired }))).toEqual(
        expected.map((id) => ({
          id,
          status: id === INACTIVE_BOOK ? 'inactive' : 'active',
          acquired: true,
        })),
      );
      expect(batch.nextCursor).toBeNull();
    });

    it("lists a child's books in the child scope, the inactive ones too, and no one else's", async () => {
      const ours = await newFamily();
      const kid = await addChild(running.server, admin, ours.id, { nickname: '小米' });
      const other = await addChild(running.server, admin, ours.id, { nickname: '豆豆' });
      await acquire(running.server, admin, ours.id, ACTIVE_BOOK);
      await acquire(running.server, admin, ours.id, 'abc-songs');
      await insertFamilyBook(running.databaseUrl, ours.id, INACTIVE_BOOK);
      await insertAssignment(
        running.databaseUrl,
        { familyId: ours.id, bookId: INACTIVE_BOOK },
        kid.id,
      );
      await setReaders(running.server, admin, { familyId: ours.id, bookId: ACTIVE_BOOK }, [
        kid.id,
        other.id,
      ]);
      await setReaders(running.server, admin, { familyId: ours.id, bookId: 'abc-songs' }, [
        other.id,
      ]);

      const batch = await batchOf(ours.id, { scope: 'child', child: kid.id });

      expect(batch.books.map(({ id }) => id).sort()).toEqual([ACTIVE_BOOK, INACTIVE_BOOK].sort());
      expect(batch.books.find(({ id }) => id === ACTIVE_BOOK)?.readers).toEqual([
        { childId: kid.id, nickname: '小米' },
        { childId: other.id, nickname: '豆豆' },
      ]);
    });

    it('ignores the child outside the child scope', async () => {
      const all = await batchOf(family.id);

      expect(await batchOf(family.id, { scope: 'library', child: xiaomi.id })).toEqual(all);
    });

    it('answers the child scope for a child not in the family with 404 child_not_found', async () => {
      const other = await newFamily();
      const theirs = await addChild(running.server, admin, other.id);
      const deleted = await addChild(running.server, admin, family.id);
      await asMember().delete(`/api/families/${family.id}/children/${deleted.id}`).expect(204);

      const responses = await Promise.all(
        [theirs.id, deleted.id, crypto.randomUUID()].map((child) =>
          asMember().get(`${booksPath(family.id)}${queryOf({ scope: 'child', child })}`),
        ),
      );

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'child_not_found']));
    });

    it('answers a malformed query with 400 and the fields', async () => {
      const cases: Array<[Parameters, Array<{ path: string; code: string }>]> = [
        [{ scope: 'child' }, [{ path: 'child', code: 'required' }]],
        [{ scope: 'everything' }, [{ path: 'scope', code: 'invalid' }]],
        [{ scope: 'child', child: 'not-a-uuid' }, [{ path: 'child', code: 'invalid' }]],
      ];

      for (const [parameters, fields] of cases) {
        const response = await asMember().get(`${booksPath(family.id)}${queryOf(parameters)}`);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ error: { code: 'invalid_request', fields } });
      }
    });

    it('answers a cursor it did not make with 400 and the field cursor', async () => {
      const { nextCursor } = await batchOf(family.id);
      const made = nextCursor ?? '';
      const cursors = [
        'not a cursor',
        `${made}A`,
        `${made}=`,
        made.slice(0, -1),
        made.replace(/[A-Za-z]/, (letter) =>
          letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase(),
        ),
        cursorOf(['2026-11-23T07:46:00Z', ACTIVE_BOOK]),
        cursorOf(['2026-02-30T07:46:00.000000Z', ACTIVE_BOOK]),
        cursorOf(['2026-11-23T07:46:00.000000Z', "x' or 1=1 --"]),
        cursorOf(['2026-11-23T07:46:00.000000Z', ACTIVE_BOOK, 'more']),
        cursorOf({ createdAt: '2026-11-23T07:46:00.000000Z', id: ACTIVE_BOOK }),
        'A'.repeat(400),
      ];

      for (const cursor of cursors) {
        const response = await asMember().get(`${booksPath(family.id)}${queryOf({ cursor })}`);

        expect(response.status, cursor).toBe(400);
        expect(response.body).toMatchObject({
          error: { code: 'invalid_request', fields: [{ path: 'cursor', code: 'invalid' }] },
        });
      }
    });

    it("continues after the cursor's book, which need not be one the api answered", async () => {
      const [row] = await query<{ created_at: string }>(
        running.databaseUrl,
        `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
         from books where id = $1`,
        [ACTIVE_BOOK],
      );
      const active = await activeBooks();

      const batch = await batchOf(family.id, { cursor: cursorOf([row?.created_at, ACTIVE_BOOK]) });

      expect(batch.books.map(({ id }) => id)).toEqual(
        active.slice(active.indexOf(ACTIVE_BOOK) + 1).slice(0, 12),
      );
    });
  });

  describe('the filter options', () => {
    async function filtersOf(familyId: string, parameters: Parameters = {}) {
      const response = await asMember().get(`${filtersPath(familyId)}${queryOf(parameters)}`);
      expect(response.status).toBe(200);
      return bookFiltersResponseSchema.parse(response.body);
    }

    it('answers every grade in the set order and the subjects with books', async () => {
      const grades = await query<{ id: string; name: string }>(
        running.databaseUrl,
        'select id, name from grades order by position',
      );

      const filters = await filtersOf(family.id);

      expect(filters.grades).toEqual(grades);
      expect(filters.grades.slice(0, 3).map(({ name }) => name)).toEqual([
        '学前',
        '一年级',
        '二年级',
      ]);
      expect(filters.subjects.map(({ id }) => id).slice(0, SAMPLE_SUBJECTS.length)).toEqual(
        SAMPLE_SUBJECTS,
      );
    });

    it('answers only the subjects with books of the grades asked for, in the set order', async () => {
      const expected = await query<{ id: string; name: string }>(
        running.databaseUrl,
        `select s.id, s.name from subjects s
         where exists (select 1 from books b where b.subject_id = s.id and b.status = 'active'
                       and b.grade_id in ('grade-7', 'grade-9'))
         order by s.position`,
      );

      const filters = await filtersOf(family.id, { grade: ['grade-7', 'grade-9', 'nope'] });

      expect(filters.subjects).toEqual(expected);
      expect(filters.subjects.length).toBeLessThan(SAMPLE_SUBJECTS.length);
    });

    it("answers the subjects of the family's books and of a child's books", async () => {
      const ours = await newFamily();
      const kid = await addChild(running.server, admin, ours.id);
      await acquire(running.server, admin, ours.id, ACTIVE_BOOK);
      await acquire(running.server, admin, ours.id, 'abc-songs');
      await setReaders(running.server, admin, { familyId: ours.id, bookId: 'abc-songs' }, [kid.id]);

      const ofFamily = await filtersOf(ours.id, { scope: 'family' });
      const ofChild = await filtersOf(ours.id, { scope: 'child', child: kid.id });
      const none = await filtersOf(ours.id, { scope: 'family', grade: 'grade-9' });

      expect(ofFamily.subjects).toEqual([
        { id: 'math', name: '数学' },
        { id: 'english', name: '英语' },
      ]);
      expect(ofChild.subjects).toEqual([{ id: 'english', name: '英语' }]);
      expect(none.subjects).toEqual([]);
      expect(none.grades).toEqual(ofFamily.grades);
    });

    it('answers a child not in the family with 404 child_not_found', async () => {
      const response = await asMember().get(
        `${filtersPath(family.id)}${queryOf({ scope: 'child', child: crypto.randomUUID() })}`,
      );

      expect(outcomesOf([response])).toEqual([[404, 'child_not_found']]);
    });
  });

  describe("a book's page", () => {
    it('answers a book the family does not have, with no readers and no replacement', async () => {
      const response = await asMember().get(bookPath(family.id, 'abc-songs'));

      expect(response.status).toBe(200);
      expect(bookDetailSchema.parse(response.body)).toMatchObject({
        id: 'abc-songs',
        status: 'active',
        acquired: false,
        readers: [],
        replacement: null,
      });
    });

    it('answers the readers in the order the children were added', async () => {
      await acquire(running.server, member, family.id, ACTIVE_BOOK);
      await setReaders(running.server, member, { familyId: family.id, bookId: ACTIVE_BOOK }, [
        doudou.id,
        xiaomi.id,
      ]);

      const response = await asMember().get(bookPath(family.id, ACTIVE_BOOK));

      expect(bookDetailSchema.parse(response.body)).toMatchObject({
        acquired: true,
        readers: [
          { childId: xiaomi.id, nickname: '小米' },
          { childId: doudou.id, nickname: '豆豆' },
        ],
      });
    });

    it('answers an inactive book the family has with its active replacement', async () => {
      const ours = await newFamily();
      await insertFamilyBook(running.databaseUrl, ours.id, INACTIVE_BOOK);

      const response = await asMember().get(bookPath(ours.id, INACTIVE_BOOK));

      expect(bookDetailSchema.parse(response.body)).toMatchObject({
        id: INACTIVE_BOOK,
        status: 'inactive',
        acquired: true,
        replacement: { id: ACTIVE_BOOK, title: '胡萝卜数数大冒险' },
      });
    });

    it('answers no replacement when the replacement is inactive too, or there is none', async () => {
      const ours = await newFamily();
      const gradeId = await insertGrade(running.databaseUrl);
      const subjectId = await insertSubject(running.databaseUrl);
      const gone = await insertBook(running.databaseUrl, {
        gradeId,
        subjectId,
        status: 'inactive',
      });
      const replacedByGone = await insertBook(running.databaseUrl, {
        gradeId,
        subjectId,
        status: 'inactive',
        replacementId: gone,
      });
      for (const bookId of [gone, replacedByGone]) {
        await insertFamilyBook(running.databaseUrl, ours.id, bookId);
      }

      const responses = await Promise.all(
        [gone, replacedByGone].map((bookId) => asMember().get(bookPath(ours.id, bookId))),
      );

      expect(responses.map(({ body }) => (body as { replacement: unknown }).replacement)).toEqual([
        null,
        null,
      ]);
      expect(responses.map(({ body }) => (body as BookCard).coverUrl)).toEqual([null, null]);
    });

    it('answers a missing book, and an inactive book the family does not have, with 404 book_not_found', async () => {
      const responses = await Promise.all(
        ['no-such-book', INACTIVE_BOOK, 'Not_A_Book_Id', 'a'.repeat(61)].map((bookId) =>
          asMember().get(bookPath(family.id, bookId)),
        ),
      );

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'book_not_found']));
    });
  });
});
