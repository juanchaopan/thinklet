import { defineConfig } from 'drizzle-kit';

// CD sets MIGRATION_DATABASE_URL to the database's direct (unpooled)
// connection; where it is not set, as on a developer machine, DATABASE_URL is used.
const url = process.env['MIGRATION_DATABASE_URL'] || process.env['DATABASE_URL'];
if (!url) {
  throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
});
