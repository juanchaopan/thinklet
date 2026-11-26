import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Client } from 'pg';
import { migrateThrough, migrationRows, startDatabaseBefore } from '../support/migrations.js';

const TAG = '0008_grade_range';

const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

/** The books the test adds itself, kept apart from the sample books by their ids. */
const TEST_BOOK_PREFIX = 'test-book-';

/** A grade of a book as the books table keeps it: the grade's id and its level. */
type GradeKey = [id: string, level: number];

/** A book's three grades, written after the migration. */
interface Range {
  min: GradeKey;
  max: GradeKey;
  teaching: GradeKey;
}

/** What the database refuses a statement with: its SQLSTATE and the constraint. */
interface Refusal {
  code: string | undefined;
  constraint: string | undefined;
}

// Books cover a range of grades and teach at one grade within it (#21,
// data.md, books): the migration gives every book written so far its one
// grade as the lowest, highest and teaching grade, with that grade's
// level, and drops the one grade. Afterwards the database refuses a range
// that runs backwards, a teaching grade outside the range and a level that
// is not its grade's, so a migration script that writes one fails. The
// database stops at this script.
describe(`migration ${TAG}`, () => {
  let client: Client;
  let database: StartedPostgreSqlContainer;
  /** Every book's one grade in the previous version, the sample books and the test's own. */
  let gradeBefore: Map<string, string>;
  let written = 0;
  const { rows } = migrationRows(() => client);

  /** Adds a book in the previous version's format, of the one grade given. */
  const insertEarlierBook = (id: string, gradeId: string, status = 'active') =>
    client.query(
      `insert into books (id, title, intro, grade_id, subject_id, status)
       values ($1, '旧格式的书', '迁移之前写的书。', $2, 'math', $3)`,
      [id, gradeId, status],
    );

  /**
   * Writes a book of the range as a migration script does after this one;
   * answers what the database refuses it with, or undefined when it is written.
   */
  async function refusalOf({ min, max, teaching }: Range): Promise<Refusal | undefined> {
    written += 1;
    try {
      await client.query(
        `insert into books
           (id, title, intro, min_grade_id, min_grade_level, max_grade_id, max_grade_level,
            teaching_grade_id, teaching_grade_level, subject_id, status)
         values ($1, '新格式的书', '迁移之后写的书。', $2, $3, $4, $5, $6, $7, 'math', 'active')`,
        [`${TEST_BOOK_PREFIX}after-${written}`, ...min, ...max, ...teaching],
      );
      return undefined;
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      return { code, constraint };
    }
  }

  beforeAll(async () => {
    const started = await startDatabaseBefore(TAG);
    ({ database, client } = started);

    await insertEarlierBook(`${TEST_BOOK_PREFIX}senior`, 'grade-12');
    await insertEarlierBook(`${TEST_BOOK_PREFIX}preschool`, 'preschool', 'inactive');
    const before = await rows<{ id: string; grade_id: string }>('select id, grade_id from books');
    gradeBefore = new Map(before.map(({ id, grade_id }) => [id, grade_id]));

    await migrateThrough(started.url, TAG);
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  describe('the books written before it', () => {
    it('keeps every book, the sample books and the earlier ones alike', async () => {
      const after = await rows<{ id: string }>('select id from books');

      expect(after.map(({ id }) => id).sort()).toEqual([...gradeBefore.keys()].sort());
      expect(gradeBefore.size).toBe(33);
    });

    it("gives every book its one grade as the lowest, highest and teaching grade, with that grade's level", async () => {
      const after = await rows<{
        id: string;
        min_grade_id: string;
        min_grade_level: number;
        max_grade_id: string;
        max_grade_level: number;
        teaching_grade_id: string;
        teaching_grade_level: number;
        level: number;
      }>(
        `select books.id, min_grade_id, min_grade_level, max_grade_id, max_grade_level,
                teaching_grade_id, teaching_grade_level, grades.level
         from books join grades on grades.id = books.min_grade_id`,
      );

      expect(after).toHaveLength(gradeBefore.size);
      for (const { level, ...book } of after) {
        const grade = gradeBefore.get(book.id);
        expect(book, book.id).toEqual({
          id: book.id,
          min_grade_id: grade,
          min_grade_level: level,
          max_grade_id: grade,
          max_grade_level: level,
          teaching_grade_id: grade,
          teaching_grade_level: level,
        });
      }
    });

    it('gives the earlier books of the first and the last grade the levels 0 and 12', async () => {
      expect(
        await rows(
          `select id, min_grade_level, max_grade_level, teaching_grade_level from books
           where id like '${TEST_BOOK_PREFIX}%' order by id`,
        ),
      ).toEqual([
        {
          id: `${TEST_BOOK_PREFIX}preschool`,
          min_grade_level: 0,
          max_grade_level: 0,
          teaching_grade_level: 0,
        },
        {
          id: `${TEST_BOOK_PREFIX}senior`,
          min_grade_level: 12,
          max_grade_level: 12,
          teaching_grade_level: 12,
        },
      ]);
    });
  });

  it('drops the one grade and makes the three grades and their levels required', async () => {
    const columns = await rows(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'books' and column_name like '%grade%'
       order by column_name`,
    );

    expect(columns).toEqual(
      ['max', 'min', 'teaching'].flatMap((end) => [
        { column_name: `${end}_grade_id`, data_type: 'text', is_nullable: 'NO' },
        { column_name: `${end}_grade_level`, data_type: 'integer', is_nullable: 'NO' },
      ]),
    );
  });

  it('keeps the grades unique by id and level together, for the books to reference', async () => {
    expect(
      await rows(
        `select pg_get_constraintdef(oid) as definition from pg_constraint
         where conname = 'grades_id_level_unique'`,
      ),
    ).toEqual([{ definition: 'UNIQUE (id, level)' }]);
  });

  describe('the constraints', () => {
    it.each<[string, GradeKey]>([
      ['at the lowest grade', ['grade-4', 4]],
      ['within the range', ['grade-6', 6]],
      ['at the highest grade', ['grade-8', 8]],
    ])('accepts a range with the teaching grade %s', async (_case, teaching) => {
      expect(
        await refusalOf({ min: ['grade-4', 4], max: ['grade-8', 8], teaching }),
      ).toBeUndefined();
    });

    it('accepts a range of one grade', async () => {
      expect(
        await refusalOf({ min: ['grade-2', 2], max: ['grade-2', 2], teaching: ['grade-2', 2] }),
      ).toBeUndefined();
    });

    it('rejects a range whose lowest grade is above its highest', async () => {
      expect(
        await refusalOf({ min: ['grade-6', 6], max: ['grade-4', 4], teaching: ['grade-6', 6] }),
      ).toEqual({ code: CHECK_VIOLATION, constraint: 'books_grade_range_check' });
    });

    it.each<[string, GradeKey]>([
      ['below', ['grade-3', 3]],
      ['above', ['grade-9', 9]],
    ])('rejects a teaching grade %s the range', async (_case, teaching) => {
      expect(await refusalOf({ min: ['grade-4', 4], max: ['grade-8', 8], teaching })).toEqual({
        code: CHECK_VIOLATION,
        constraint: 'books_teaching_grade_check',
      });
    });

    it.each<[string, string, Range]>([
      [
        'the lowest grade',
        'books_min_grade_fk',
        { min: ['grade-4', 5], max: ['grade-8', 8], teaching: ['grade-6', 6] },
      ],
      [
        'the highest grade',
        'books_max_grade_fk',
        { min: ['grade-4', 4], max: ['grade-8', 7], teaching: ['grade-6', 6] },
      ],
      [
        'the teaching grade',
        'books_teaching_grade_fk',
        { min: ['grade-4', 4], max: ['grade-8', 8], teaching: ['grade-6', 5] },
      ],
    ])("rejects a level of %s that is not the grade's", async (_case, constraint, range) => {
      expect(await refusalOf(range)).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint });
    });

    it('rejects a grade that does not exist', async () => {
      expect(
        await refusalOf({
          min: ['grade-13', 13],
          max: ['grade-13', 13],
          teaching: ['grade-13', 13],
        }),
      ).toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });
});
