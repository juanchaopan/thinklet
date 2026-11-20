import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { apiDirectory, migrate, startDatabase } from '../support/containers.js';

async function query<T extends object>(url: string, text: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

function journalEntries(): unknown[] {
  const journal = readFileSync(join(apiDirectory, 'drizzle', 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(journal) as { entries: unknown[] }).entries;
}

describe('drizzle-kit migrate', () => {
  let database: StartedPostgreSqlContainer;

  beforeAll(async () => {
    database = await startDatabase();
  });

  afterAll(async () => {
    await database?.stop();
  });

  it('records every migration in __drizzle_migrations on an empty database', async () => {
    const url = database.getConnectionUri();

    await migrate(url);

    const [table] = await query<{ name: string | null }>(
      url,
      `select to_regclass('drizzle.__drizzle_migrations')::text as name`,
    );
    expect(table?.name).toBe('drizzle.__drizzle_migrations');
    const [applied] = await query<{ count: string }>(
      url,
      'select count(*) as count from drizzle.__drizzle_migrations',
    );
    expect(Number(applied?.count)).toBe(journalEntries().length);
  });

  it('changes nothing when it runs again', async () => {
    const url = database.getConnectionUri();
    await migrate(url);
    const before = await query(url, 'select * from drizzle.__drizzle_migrations order by id');

    await migrate(url);

    expect(await query(url, 'select * from drizzle.__drizzle_migrations order by id')).toEqual(
      before,
    );
  });
});
