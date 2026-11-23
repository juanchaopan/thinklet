import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { coverBookIdPipe, coverVersionPipe } from './book-params.js';
import { ForParentOrChild } from './book-reader.guard.js';
import { CoverService } from './cover.service.js';

/**
 * How long the browser keeps a cover: a year, without asking again, as the
 * address carries the cover's hash and so never names another image;
 * `private` keeps shared caches from storing what only a signed-in user
 * may read.
 */
const COVER_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * A book's cover (`.docs/design/interfaces.md`, "封面"), for a signed-in
 * parent or child.
 */
@Controller('books')
@ForParentOrChild()
export class CoverController {
  constructor(private readonly coverService: CoverService) {}

  /**
   * The cover as stored. The caching header is set only once the cover is
   * read, so a refusal is never kept: a cover missing from storage for a
   * moment is asked for again.
   */
  @Get(':bookId/cover')
  async cover(
    @Param('bookId', coverBookIdPipe) bookId: string,
    @Query('v', coverVersionPipe) version: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { body, contentType } = await this.coverService.cover(bookId, version);
    response.setHeader('Cache-Control', COVER_CACHE_CONTROL);
    return new StreamableFile(body, { type: contentType, length: body.length });
  }
}
