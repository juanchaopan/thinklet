import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runCommand } from './infrastructure/commands/run-command.js';
import type { RebuildEnvironment } from './infrastructure/config/rebuild-environment.js';
import { defaultContentDirectory } from './modules/book/cover-files.js';
import { CoverImportError, CoverImportService } from './modules/book/cover-import.service.js';
import { RebuildModule } from './rebuild.module.js';

// Entry point of the cover import (`task rebuild`, decision 0035): imports
// the covers of the books in the book table from content/books/ into
// storage and records their hashes. It runs after the migrations, starts
// only the database, storage and the import, and exits with a non-zero code
// when anything fails. Nothing it logs holds a configured value: the
// summary is counts, a cover problem names the book and the file, and any
// other error is logged through describeError, which leaves out URLs and
// database messages.

const logger = new Logger('CoverImport');

await runCommand({
  module: RebuildModule,
  logger,
  failure: 'Cover import failed.',
  safeErrors: [CoverImportError],
  work: async (context) => {
    const configured = context
      .get(ConfigService<RebuildEnvironment, true>)
      .get('BOOK_CONTENT_DIRECTORY', { infer: true });
    const contentDirectory =
      configured === undefined ? defaultContentDirectory() : resolve(configured);
    const summary = await context.get(CoverImportService).importCovers(contentDirectory);
    logger.log(
      `Covers of ${summary.books} books: ${summary.uploaded} uploaded, ${summary.unchanged} unchanged; ${summary.recorded} recorded in the book table`,
    );
  },
});
