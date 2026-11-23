import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';
import { books, type CoverType } from '../../infrastructure/database/schema.js';

/** The cover recorded for a book in the book table. */
export interface RecordedCover {
  bookId: string;
  type: CoverType;
  sha256: string;
}

@Injectable()
export class CoverImportRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** The id of every book in the book table, in order. */
  async listBookIds(): Promise<string[]> {
    const rows = await this.database.select({ id: books.id }).from(books).orderBy(asc(books.id));
    return rows.map((row) => row.id);
  }

  /**
   * Records every book's cover type and hash in one transaction, so the
   * table holds either the old covers or the new ones. Only rows whose
   * cover differs are written, so a rerun leaves the table as it is.
   * Answers how many rows changed.
   */
  async recordCovers(covers: readonly RecordedCover[]): Promise<number> {
    return this.database.transaction(async (transaction) => {
      let changed = 0;
      for (const cover of covers) {
        const result = await transaction
          .update(books)
          .set({ coverType: cover.type, coverSha256: cover.sha256 })
          .where(
            and(
              eq(books.id, cover.bookId),
              or(
                sql`${books.coverType} is distinct from ${cover.type}`,
                sql`${books.coverSha256} is distinct from ${cover.sha256}`,
              ),
            ),
          );
        changed += result.rowCount ?? 0;
      }
      return changed;
    });
  }
}
