import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../infrastructure/errors/api-error.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { BooksRepository } from './books.repository.js';
import { COVER_MEDIA_TYPES, coverStorageKey } from './cover-image.js';

/** A cover that does not exist, of a book that does not or under another hash, is answered the same. */
export const coverNotFound = () => new ApiError('not_found', HttpStatus.NOT_FOUND);

/** A cover's bytes and the media type they are served with. */
export interface CoverImage {
  body: Uint8Array;
  contentType: string;
}

/**
 * The books' covers (`.docs/design/interfaces.md`, "封面"), read from
 * storage as the cover import wrote them. A cover is asked for by its
 * hash, so an address names one version of it for good.
 */
@Injectable()
export class CoverService {
  constructor(
    private readonly repository: BooksRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * The book's cover when `version` is the hash the book table records for
   * it. A book without a cover, another hash, or a cover missing from
   * storage is 404 `not_found`, and the web app shows the default cover.
   */
  async cover(bookId: string, version: string | undefined): Promise<CoverImage> {
    const cover = await this.repository.findCover(bookId);
    if (cover === undefined || version !== cover.sha256) {
      throw coverNotFound();
    }
    const object = await this.storage.getObject(coverStorageKey(bookId, cover.type));
    if (object === undefined) {
      throw coverNotFound();
    }
    return { body: object.body, contentType: COVER_MEDIA_TYPES[cover.type] };
  }
}
