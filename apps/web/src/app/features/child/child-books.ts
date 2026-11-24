import { Injectable, inject, signal } from '@angular/core';
import { childBooksResponseSchema, type ChildBooksResponse } from '@thinklet/contracts';
import { Api, type ApiError } from '../../core/api';
import { asApiError, isSignedOut } from '../../core/failures';
import { FreshReads } from '../../core/fresh-reads';

/**
 * The books assigned to the signed-in child, latest assignment first, with
 * how many of them the child has not opened yet (`GET /api/child/books`,
 * interfaces.md, 孩子（孩子登录后）). It goes through the child's own api
 * only, so a login that has ended sends the child to the child login.
 *
 * Provide it on the page that shows the books.
 */
@Injectable()
export class ChildBooks {
  private readonly api = inject(Api);
  private readonly reads = new FreshReads();
  private readonly shownShelf = signal<ChildBooksResponse | null>(null);
  private readonly problem = signal<ApiError | null>(null);

  /** The child's books as last read; null until they have been read once. */
  readonly shelf = this.shownShelf.asReadonly();
  /** Why the books could not be read while none are shown; the page says it did not open. */
  readonly failure = this.problem.asReadonly();

  /**
   * Reads the books. A failure is shown only while no books are; the problem
   * shown stays until a read succeeds, so trying again does not flicker.
   */
  async load(): Promise<void> {
    const fresh = this.reads.start();
    try {
      const shelf = await this.api.get('/api/child/books', childBooksResponseSchema);
      if (fresh()) {
        this.shownShelf.set(shelf);
        this.problem.set(null);
      }
    } catch (error) {
      // A 401 has already sent the child to the child login.
      if (fresh() && !isSignedOut(error) && this.shownShelf() === null) {
        this.problem.set(asApiError(error));
      }
    }
  }

  /**
   * Reads the books shown again, so books assigned or taken back meanwhile
   * and the count of new books catch up; a failure keeps what is shown.
   */
  async refresh(): Promise<void> {
    if (this.shownShelf() !== null) {
      await this.load();
    }
  }
}
