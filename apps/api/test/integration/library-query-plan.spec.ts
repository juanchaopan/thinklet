import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../../src/infrastructure/database/schema.js';
import { BookStore } from '../../src/modules/book/books.repository.js';
import { BOOK_BATCH_SIZE } from '../../src/modules/book/library.service.js';
import { migrate, startDatabase } from '../support/containers.js';

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

// The library reads every batch in the order of books_created_at_id_idx:
// the index has to give the order the repository's statement asks for, so
// PostgreSQL reads the batch from it instead of sorting every book.
describe('library query plan', () => {
  let database: StartedPostgreSqlContainer | undefined;
  let client: Client;

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
      { scope: 'library', familyId: randomUUID(), gradeIds: [] },
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
    database = await startDatabase();
    const url = database.getConnectionUri();
    await migrate(url);
    client = new Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await database?.stop();
  });

  it("reads the library's first batch in its order from books_created_at_id_idx, without sorting", async () => {
    const nodes = await planWithoutSorting(await firstLibraryBatch());

    const types = nodes.map((node) => node['Node Type']);
    expect(types.filter((type) => type.includes('Sort'))).toEqual([]);
    expect(nodes.map((node) => node['Index Name'])).toContain('books_created_at_id_idx');
  });
});
