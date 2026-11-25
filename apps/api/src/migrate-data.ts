import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { DataMigrationError } from './data-migrations/apply-data-migrations.js';
import { DataMigrationsService } from './data-migrations/data-migrations.service.js';
import { ChildDataDecryptionError } from './infrastructure/child-data/child-data-cipher.js';
import { runCommand } from './infrastructure/commands/run-command.js';
import { MigrateDataModule } from './migrate-data.module.js';

// Entry point of the data migrations written in code (`task migrate`, after
// drizzle-kit migrate; decision 0018). It starts only the database and the
// child data cipher, runs the migrations that have not run yet and exits
// with a non-zero code when anything fails. It runs from the build,
// dist/migrate-data.js, and reads the checksums of the migrations from their
// TypeScript files in src/data-migrations/ beside it, the files a migration
// is reviewed and merged as. Nothing it logs holds a configured value or
// child data: the summary names migrations, and any error but the runner's
// own and the cipher's, which name neither, is logged through
// describeError, which leaves out URLs and database messages.

const logger = new Logger('DataMigrations');

/** The migrations' TypeScript files, from the build in apps/api/dist/. */
const sourceDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'data-migrations',
);

await runCommand({
  module: MigrateDataModule,
  logger,
  failure: 'Data migrations failed.',
  safeErrors: [DataMigrationError, ChildDataDecryptionError],
  work: async (context) => {
    const applied = await context.get(DataMigrationsService).apply(sourceDirectory);
    logger.log(
      applied.length === 0
        ? 'No data migrations to run'
        : `Data migrations run: ${applied.join(', ')}`,
    );
  },
});
