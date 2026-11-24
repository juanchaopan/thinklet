import { Injectable, signal } from '@angular/core';
import type { Params } from '@angular/router';

/**
 * The query of the library's address as the library last showed it, which
 * holds its filters (rules.md, 筛选), so 返回 on a book page leads back to
 * the library with the filters it had. Until the library has been shown on
 * this visit it is the whole library.
 */
@Injectable({ providedIn: 'root' })
export class LibraryAddress {
  private readonly last = signal<Params>({});

  /** The library's query parameters as last shown. */
  readonly query = this.last.asReadonly();

  /** Keeps the query parameters of the library shown now. */
  remember(query: Params): void {
    this.last.set(query);
  }
}
