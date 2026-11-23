import { Injectable } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { readBookCover, type LocalCover } from './cover-files.js';
import { COVER_MEDIA_TYPES, coverStorageKey } from './cover-image.js';
import { CoverImportRepository } from './cover-import.repository.js';

/** The metadata entry each stored cover carries with the SHA-256 of its bytes. */
export const COVER_SHA256_METADATA = 'sha256';

/** What one import did. */
export interface CoverImportSummary {
  /** The books in the book table, each of which has a cover. */
  books: number;
  /** Covers written to storage because the stored one was missing or different. */
  uploaded: number;
  /** Covers already in storage as they are in the repository. */
  unchanged: number;
  /** Books whose cover type or hash in the book table changed. */
  recorded: number;
}

/** A book whose cover cannot be imported, and why. */
export interface CoverProblem {
  bookId: string;
  problem: string;
}

/** The import stopped before changing anything because some books' covers are missing or break the rules. */
export class CoverImportError extends Error {
  override readonly name = 'CoverImportError';

  constructor(readonly problems: readonly CoverProblem[]) {
    super(
      [
        `Nothing was imported: ${problems.length} book(s) have no usable cover.`,
        ...problems.map(({ bookId, problem }) => `- book ${bookId}: ${problem}`),
      ].join('\n'),
    );
  }
}

/**
 * Brings the stored covers and the book table in line with the book
 * folders under the content directory (decisions 0035 and 0036). Only the
 * books in the book table are handled: a folder without a book is ignored,
 * and the stored cover of a book that is gone is left alone.
 */
@Injectable()
export class CoverImportService {
  constructor(
    private readonly repository: CoverImportRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * Checks every book's cover first and changes nothing when any is missing
   * or breaks the rules. Then writes each cover whose stored copy is missing
   * or differs, and last records every cover's type and hash in one
   * transaction, so the table never points at a cover that is not stored.
   * Running it again with the same files changes nothing.
   */
  async importCovers(contentDirectory: string): Promise<CoverImportSummary> {
    const bookIds = await this.repository.listBookIds();
    const readings = await Promise.all(
      bookIds.map(async (bookId) => ({
        bookId,
        reading: await readBookCover(contentDirectory, bookId),
      })),
    );

    const problems: CoverProblem[] = [];
    const covers: Array<{ bookId: string; cover: LocalCover }> = [];
    for (const { bookId, reading } of readings) {
      if ('problem' in reading) {
        problems.push({ bookId, problem: reading.problem });
      } else {
        covers.push({ bookId, cover: reading.cover });
      }
    }
    if (problems.length > 0) {
      throw new CoverImportError(problems);
    }

    let uploaded = 0;
    for (const { bookId, cover } of covers) {
      if (await this.upload(bookId, cover)) {
        uploaded += 1;
      }
    }
    const recorded = await this.repository.recordCovers(
      covers.map(({ bookId, cover }) => ({ bookId, type: cover.type, sha256: cover.sha256 })),
    );
    return { books: covers.length, uploaded, unchanged: covers.length - uploaded, recorded };
  }

  /**
   * Writes the cover unless storage already holds these bytes with the
   * right media type, which the hash in the stored object's metadata tells
   * without reading it. Checking storage rather than the book table also
   * restores a cover that is gone from storage. Answers whether it wrote.
   */
  private async upload(bookId: string, cover: LocalCover): Promise<boolean> {
    const key = coverStorageKey(bookId, cover.type);
    const contentType = COVER_MEDIA_TYPES[cover.type];
    const stored = await this.storage.headObject(key);
    if (
      stored?.contentType === contentType &&
      stored.metadata[COVER_SHA256_METADATA] === cover.sha256
    ) {
      return false;
    }
    await this.storage.putObject(key, {
      body: cover.bytes,
      contentType,
      metadata: { [COVER_SHA256_METADATA]: cover.sha256 },
    });
    return true;
  }
}
