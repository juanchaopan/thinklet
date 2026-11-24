import { randomBytes, randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Client } from 'pg';
import * as schema from '../../src/infrastructure/database/schema.js';
import { BookStore } from '../../src/modules/book/books.repository.js';
import { BOOK_BATCH_SIZE } from '../../src/modules/book/library.service.js';
import { migrate } from '../support/containers.js';
import { migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0002_library_and_books';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
/** What PostgreSQL answers a delete that an `on delete restrict` foreign key refuses with. */
const RESTRICT_VIOLATION = '23001';

/** The books the test adds itself, kept apart from the sample books by their ids. */
const TEST_BOOK_PREFIX = 'test-book-';
const SAMPLE_BOOKS = `books.id not like '${TEST_BOOK_PREFIX}%'`;

/** A family of the previous version with its admin, a child and two join requests. */
interface EarlierData {
  parentId: string;
  familyId: string;
  childId: string;
  pendingRequestId: string;
  rejectedRequestId: string;
  dismissedAt: Date;
}

/** A book row to insert; every field the test does not name gets a valid value. */
interface BookFields {
  id?: string;
  title?: string;
  intro?: string;
  gradeId?: string;
  subjectId?: string;
  status?: string;
  replacementId?: string | null;
  coverType?: string | null;
  coverSha256?: string | null;
}

/** A statement as Drizzle sends it to PostgreSQL. */
interface SentQuery {
  text: string;
  params: unknown[];
}

/** A node of a plan as `EXPLAIN (FORMAT JSON)` writes it, with the nodes under it. */
interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

/** The node and every node under it. */
function nodesOf(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodesOf)];
}

describe(`migration ${TAG}`, () => {
  let database: StartedPostgreSqlContainer;
  let client: Client;
  let earlier: EarlierData;
  const { rows, insertedId, newParent, newFamily } = migrationRows(() => client);

  function newChild(familyId: string, parentId: string): Promise<string> {
    return insertedId(
      `insert into children
         (family_id, nickname, account, account_lookup, consent_parent_id, consent_version, consented_at)
       values ($1, 'nickname-ciphertext', 'account-ciphertext', $3, $2, '2026-11-22', now())
       returning id`,
      [familyId, parentId, randomBytes(32).toString('hex')],
    );
  }

  /** A book with a fresh test id, valid unless the fields say otherwise. */
  function insertBook(fields: BookFields = {}) {
    const book = {
      id: `${TEST_BOOK_PREFIX}${randomUUID()}`,
      title: '测试书',
      intro: '一本只在测试里的书。',
      gradeId: 'grade-1',
      subjectId: 'math',
      status: 'active',
      replacementId: null,
      coverType: null,
      coverSha256: null,
      ...fields,
    };
    return client.query(
      `insert into books
         (id, title, intro, grade_id, subject_id, status, replacement_id, cover_type, cover_sha256)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        book.id,
        book.title,
        book.intro,
        book.gradeId,
        book.subjectId,
        book.status,
        book.replacementId,
        book.coverType,
        book.coverSha256,
      ],
    );
  }

  function acquire(familyId: string, bookId: string) {
    return client.query(
      'insert into family_books (family_id, book_id, acquired_by) values ($1, $2, $3)',
      [familyId, bookId, earlier.parentId],
    );
  }

  function assign(childId: string, familyId: string, bookId: string) {
    return client.query(
      `insert into book_assignments (child_id, family_id, book_id, assigned_by)
       values ($1, $2, $3, $4)`,
      [childId, familyId, bookId, earlier.parentId],
    );
  }

  function removeFromFamily(familyId: string, bookId: string) {
    return client.query('delete from family_books where family_id = $1 and book_id = $2', [
      familyId,
      bookId,
    ]);
  }

  async function columnsOf(table: string): Promise<string[]> {
    const found = await rows<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [table],
    );
    return found.map(({ column_name }) => column_name);
  }

  /** The statement the repository sends for the library's first batch, with no filters. */
  async function firstLibraryBatch(): Promise<SentQuery> {
    const sent: SentQuery[] = [];
    const recording = drizzle({
      client,
      schema,
      logger: {
        logQuery: (text, params) => {
          sent.push({ text, params });
        },
      },
    });
    await new BookStore(recording).listBooks(
      { scope: 'library', familyId: earlier.familyId, gradeIds: [] },
      undefined,
      BOOK_BATCH_SIZE + 1,
    );
    const [statement] = sent;
    if (sent.length !== 1 || !statement) {
      throw new Error(`Expected one statement for the batch, got ${String(sent.length)}`);
    }
    return statement;
  }

  /**
   * The plan PostgreSQL picks for the statement when it may not sort: it
   * then reads the order from an index whenever one gives it, so a Sort
   * left in the plan means no index does. The setting lasts only for the
   * transaction.
   */
  async function planWithoutSorting({ text, params }: SentQuery): Promise<PlanNode[]> {
    await client.query('begin');
    try {
      await client.query('set local enable_sort = off');
      const result = await client.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
        `explain (format json) ${text}`,
        params,
      );
      const plan = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (!plan) {
        throw new Error('EXPLAIN gave no plan');
      }
      return nodesOf(plan);
    } finally {
      await client.query('rollback');
    }
  }

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    // A family with its admin and a child, a pending join request and a
    // rejected one both sides have dismissed, as the previous version keeps
    // them.
    const parentId = await newParent();
    const code = 'K7Q4MZ';
    const familyId = await newFamily(code);
    await client.query(
      `insert into family_members (family_id, parent_id, role) values ($1, $2, 'admin')`,
      [familyId, parentId],
    );
    const childId = await newChild(familyId, parentId);
    const pendingRequestId = await insertedId(
      `insert into join_requests (family_id, parent_id, code, status)
       values ($1, $2, $3, 'pending') returning id`,
      [familyId, await newParent(), code],
    );
    const dismissedAt = new Date('2026-11-22T10:00:00Z');
    const rejectedRequestId = await insertedId(
      `insert into join_requests
         (family_id, parent_id, code, status, closed_at, closed_by,
          dismissed_by_applicant_at, dismissed_by_admin_at)
       values ($1, $2, $3, 'rejected', $5, $4, $5, $5) returning id`,
      [familyId, await newParent(), code, parentId, dismissedAt],
    );
    earlier = { parentId, familyId, childId, pendingRequestId, rejectedRequestId, dismissedAt };

    await migrate(started.url);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  describe('the data of the previous version', () => {
    it('keeps the families, members and children', async () => {
      expect(await rows('select code from families where id = $1', [earlier.familyId])).toEqual([
        { code: 'K7Q4MZ' },
      ]);
      expect(
        await rows('select parent_id, role from family_members where family_id = $1', [
          earlier.familyId,
        ]),
      ).toEqual([{ parent_id: earlier.parentId, role: 'admin' }]);
      expect(await rows('select family_id from children where id = $1', [earlier.childId])).toEqual(
        [{ family_id: earlier.familyId }],
      );
    });

    it("keeps the join requests and the applicant's 「知道了」, without the admin's", async () => {
      expect(await columnsOf('join_requests')).not.toContain('dismissed_by_admin_at');
      expect(
        await rows(
          `select id, status, closed_by, dismissed_by_applicant_at from join_requests
           where family_id = $1 order by created_at, id`,
          [earlier.familyId],
        ),
      ).toEqual([
        {
          id: earlier.pendingRequestId,
          status: 'pending',
          closed_by: null,
          dismissed_by_applicant_at: null,
        },
        {
          id: earlier.rejectedRequestId,
          status: 'rejected',
          closed_by: earlier.parentId,
          dismissed_by_applicant_at: earlier.dismissedAt,
        },
      ]);
    });
  });

  describe('the sample data', () => {
    it('has the 13 grades in school order with their levels', async () => {
      expect(await rows('select id, name, level from grades order by position')).toEqual([
        { id: 'preschool', name: '学前', level: 0 },
        { id: 'grade-1', name: '一年级', level: 1 },
        { id: 'grade-2', name: '二年级', level: 2 },
        { id: 'grade-3', name: '三年级', level: 3 },
        { id: 'grade-4', name: '四年级', level: 4 },
        { id: 'grade-5', name: '五年级', level: 5 },
        { id: 'grade-6', name: '六年级', level: 6 },
        { id: 'grade-7', name: '初一', level: 7 },
        { id: 'grade-8', name: '初二', level: 8 },
        { id: 'grade-9', name: '初三', level: 9 },
        { id: 'grade-10', name: '高一', level: 10 },
        { id: 'grade-11', name: '高二', level: 11 },
        { id: 'grade-12', name: '高三', level: 12 },
      ]);
    });

    it('has the 5 subjects in their order', async () => {
      expect(await rows('select id, name from subjects order by position')).toEqual([
        { id: 'chinese', name: '语文' },
        { id: 'math', name: '数学' },
        { id: 'english', name: '英语' },
        { id: 'science', name: '科学' },
        { id: 'coding', name: '编程' },
      ]);
    });

    it('has 30 active sample books from preschool to 初三 and one inactive with its replacement', async () => {
      const books = await rows<{ id: string; status: string; replacement_id: string | null }>(
        `select id, status, replacement_id from books where ${SAMPLE_BOOKS}`,
      );
      expect(books).toHaveLength(31);
      expect(books.filter(({ status }) => status === 'active')).toHaveLength(30);
      expect(books.filter(({ status }) => status === 'inactive')).toEqual([
        { id: 'bunny-counts', status: 'inactive', replacement_id: 'carrot-counting' },
      ]);
      const [levels] = await rows<{ lowest: number; highest: number }>(
        `select min(grades.level) as lowest, max(grades.level) as highest
         from books join grades on grades.id = books.grade_id
         where ${SAMPLE_BOOKS}`,
      );
      expect(levels).toEqual({ lowest: 0, highest: 9 });
    });

    it('gives each sample book its own time, newest first in the order of the samples', async () => {
      const books = await rows<{ id: string; created_at: Date }>(
        `select id, created_at from books where ${SAMPLE_BOOKS} order by created_at desc, id`,
      );
      expect(books.slice(0, 3).map(({ id }) => id)).toEqual([
        'garden-rhymes',
        'carrot-counting',
        'hello-animals',
      ]);
      expect(books.at(-1)?.id).toBe('idiom-stories');
      expect(new Set(books.map(({ created_at }) => created_at.getTime())).size).toBe(31);
    });

    it('leaves the covers to the cover import', async () => {
      expect(
        await rows(
          `select count(*)::int as count from books
           where ${SAMPLE_BOOKS} and (cover_type is not null or cover_sha256 is not null)`,
        ),
      ).toEqual([{ count: 0 }]);
    });
  });

  describe('the indexes', () => {
    it("reads the library's first batch in its order from books_created_at_id_idx, without sorting", async () => {
      const nodes = await planWithoutSorting(await firstLibraryBatch());

      const types = nodes.map((node) => node['Node Type']);
      expect(types.filter((type) => type.includes('Sort'))).toEqual([]);
      expect(nodes.map((node) => node['Index Name'])).toContain('books_created_at_id_idx');
    });
  });

  describe('the constraints', () => {
    it('accepts a valid book with a cover', async () => {
      await expect(
        insertBook({ coverType: 'webp', coverSha256: 'a'.repeat(64) }),
      ).resolves.toBeDefined();
    });

    it('accepts a title of 30 characters and an intro of 200', async () => {
      await expect(
        insertBook({ title: '书'.repeat(30), intro: '字'.repeat(200) }),
      ).resolves.toBeDefined();
    });

    it.each<[string, BookFields]>([
      ['an id with capitals', { id: 'Bad-Id' }],
      ['an id with an underscore', { id: 'bad_id' }],
      ['an empty id', { id: '' }],
      ['an id of 61 characters', { id: 'b'.repeat(61) }],
      ['an empty title', { title: '' }],
      ['a title of 31 characters', { title: '书'.repeat(31) }],
      ['an empty intro', { intro: '' }],
      ['an intro of 201 characters', { intro: '字'.repeat(201) }],
      ['an unknown status', { status: 'retired' }],
      ['an unknown cover format', { coverType: 'jpeg', coverSha256: 'a'.repeat(64) }],
      ['a cover hash that is not hex SHA-256', { coverType: 'png', coverSha256: 'ABC' }],
      ['a cover format without its hash', { coverType: 'png' }],
      ['a cover hash without its format', { coverSha256: 'a'.repeat(64) }],
    ])('rejects a book with %s', async (_case, fields) => {
      await expect(insertBook(fields)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('rejects a book that replaces itself, and one replaced by a book that does not exist', async () => {
      const id = `${TEST_BOOK_PREFIX}self`;

      await expect(insertBook({ id, replacementId: id })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'books_replacement_check',
      });
      await expect(insertBook({ replacementId: 'no-such-book' })).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });

    it('rejects a book of a grade or subject that does not exist', async () => {
      await expect(insertBook({ gradeId: 'grade-13' })).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
      await expect(insertBook({ subjectId: 'music' })).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });

    it('rejects a grade with a level or position another grade has, or a bad id or name', async () => {
      const grade = (id: string, name: string, level: number, position: number) =>
        client.query('insert into grades (id, name, level, position) values ($1, $2, $3, $4)', [
          id,
          name,
          level,
          position,
        ]);

      await expect(grade('grade-x', '某年级', 3, 99)).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'grades_level_unique',
      });
      await expect(grade('grade-x', '某年级', 99, 4)).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'grades_position_unique',
      });
      await expect(grade('Grade X', '某年级', 99, 99)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(grade('grade-x', '年'.repeat(11), 99, 99)).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });

    it('rejects a subject with a position another subject has, or a bad id', async () => {
      const subject = (id: string, position: number) =>
        client.query("insert into subjects (id, name, position) values ($1, '音乐', $2)", [
          id,
          position,
        ]);

      await expect(subject('music', 1)).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'subjects_position_unique',
      });
      await expect(subject('Music', 99)).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it('does not delete a book a family has, and deletes one no family has', async () => {
      await acquire(earlier.familyId, 'moon-phases');

      await expect(
        client.query("delete from books where id = 'moon-phases'"),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });

      const id = `${TEST_BOOK_PREFIX}${randomUUID()}`;
      await insertBook({ id });
      await client.query('delete from books where id = $1', [id]);
      expect(await rows('select id from books where id = $1', [id])).toEqual([]);
    });

    it('lets a family have a book once', async () => {
      await acquire(earlier.familyId, 'robot-maze');

      await expect(acquire(earlier.familyId, 'robot-maze')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it("assigns only the family's own books to its own children", async () => {
      const otherFamilyId = await newFamily();
      const otherChildId = await newChild(otherFamilyId, earlier.parentId);
      await acquire(earlier.familyId, 'seasons-poems');

      await expect(
        assign(earlier.childId, earlier.familyId, 'seasons-poems'),
      ).resolves.toBeDefined();
      await expect(assign(otherChildId, earlier.familyId, 'seasons-poems')).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'book_assignments_child_fk',
      });
      await expect(assign(earlier.childId, earlier.familyId, 'pinyin-train')).rejects.toMatchObject(
        { code: FOREIGN_KEY_VIOLATION, constraint: 'book_assignments_family_book_fk' },
      );
    });

    it('does not remove a book from a family while a child reads it', async () => {
      await acquire(earlier.familyId, 'seed-journey');
      await assign(earlier.childId, earlier.familyId, 'seed-journey');

      await expect(removeFromFamily(earlier.familyId, 'seed-journey')).rejects.toMatchObject({
        code: RESTRICT_VIOLATION,
      });
    });

    it("deletes a child's assignments with the child, so the family can remove the book", async () => {
      const childId = await newChild(earlier.familyId, earlier.parentId);
      await acquire(earlier.familyId, 'abc-songs');
      await assign(childId, earlier.familyId, 'abc-songs');

      await client.query('delete from children where id = $1', [childId]);

      expect(
        await rows('select book_id from book_assignments where child_id = $1', [childId]),
      ).toEqual([]);
      await expect(removeFromFamily(earlier.familyId, 'abc-songs')).resolves.toMatchObject({
        rowCount: 1,
      });
    });

    it('marks a new assignment as not yet opened', async () => {
      await acquire(earlier.familyId, 'mixing-colors');
      await assign(earlier.childId, earlier.familyId, 'mixing-colors');

      const [assignment] = await rows<{ assigned_at: Date; opened_at: Date | null }>(
        `select assigned_at, opened_at from book_assignments
         where child_id = $1 and book_id = 'mixing-colors'`,
        [earlier.childId],
      );
      expect(assignment?.opened_at).toBeNull();
      expect(assignment?.assigned_at).toBeInstanceOf(Date);
    });
  });
});
