import { Client } from 'pg';

/** Runs one SQL statement on the database and returns its rows. */
export async function query<Row extends object>(
  databaseUrl: string,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** A row of the parents table. */
export interface ParentRow {
  id: string;
  name: string;
  email: string | null;
  consent_version: string;
  consented_at: Date;
}

/** The parent the mock provider's user with this subject signed in as, if any. */
export async function parentBySubject(
  databaseUrl: string,
  subject: string,
): Promise<ParentRow | undefined> {
  const rows = await query<ParentRow>(
    databaseUrl,
    'select * from parents where oidc_subject = $1',
    [subject],
  );
  return rows[0];
}
