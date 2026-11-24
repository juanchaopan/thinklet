import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { RebuildEnvironment } from './infrastructure/config/rebuild-environment.js';
import { describeError } from './infrastructure/logging/describe-error.js';
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

/** A failure as one line of its name, code and safe message. */
function failureMessage(error: unknown): string {
  if (error instanceof CoverImportError) {
    return error.message;
  }
  const { name, code, message } = describeError(error);
  return `${name}${code === undefined ? '' : ` (${code})`}: ${message}`;
}

try {
  // abortOnError off: a failure while starting is thrown to the catch below
  // instead of aborting the process, so it gets the same exit code.
  const context = await NestFactory.createApplicationContext(RebuildModule, {
    abortOnError: false,
    logger: ['fatal', 'error', 'warn', 'log'],
  });
  try {
    const configured = context
      .get(ConfigService<RebuildEnvironment, true>)
      .get('BOOK_CONTENT_DIRECTORY', { infer: true });
    const contentDirectory =
      configured === undefined ? defaultContentDirectory() : resolve(configured);
    const summary = await context.get(CoverImportService).importCovers(contentDirectory);
    logger.log(
      `Covers of ${summary.books} books: ${summary.uploaded} uploaded, ${summary.unchanged} unchanged; ${summary.recorded} recorded in the book table`,
    );
  } finally {
    await context.close();
  }
} catch (error) {
  logger.error(`Cover import failed. ${failureMessage(error)}`);
  process.exitCode = 1;
}
