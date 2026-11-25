import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  bookDetailSchema,
  bookFiltersQuerySchema,
  bookFiltersResponseSchema,
  bookListQuerySchema,
  bookListResponseSchema,
  setBookReadersRequestSchema,
  type BookDetail,
  type BookFiltersQuery,
  type BookFiltersResponse,
  type BookListQuery,
  type BookListResponse,
  type SetBookReadersRequest,
} from '@thinklet/contracts';
import { CurrentParentId } from '../../infrastructure/authentication/current-parent.js';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe.js';
import { BookFamilyGuard } from './book-family.guard.js';
import { bookIdPipe, familyIdPipe } from './book-params.js';
import { LibraryService } from './library.service.js';

/**
 * The library and the books of a family as its parents use them
 * (`.docs/design/interfaces.md`, "书库和书本（家长）"). Every route passes
 * the family's membership check first; every member may use them. The
 * parent signed in is the one a change's audit event names.
 */
@Controller('families/:familyId')
@UseGuards(BookFamilyGuard)
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  /** One batch of 12 books of the filters and scope; `nextCursor` asks for the next. */
  @Get('books')
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('familyId', familyIdPipe) familyId: string,
    @Query(new ZodValidationPipe(bookListQuerySchema)) query: BookListQuery,
  ): Promise<BookListResponse> {
    return bookListResponseSchema.parse(await this.libraryService.list(familyId, query));
  }

  /** Every grade, and the subjects that have books for the grades and scope given. */
  @Get('book-filters')
  @Header('Cache-Control', 'no-store')
  async filters(
    @Param('familyId', familyIdPipe) familyId: string,
    @Query(new ZodValidationPipe(bookFiltersQuerySchema)) query: BookFiltersQuery,
  ): Promise<BookFiltersResponse> {
    return bookFiltersResponseSchema.parse(await this.libraryService.filters(familyId, query));
  }

  @Get('books/:bookId')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('bookId', bookIdPipe) bookId: string,
  ): Promise<BookDetail> {
    return bookDetailSchema.parse(await this.libraryService.detail(familyId, bookId));
  }

  /** 200 with the book, also when the family has it already. */
  @Put('books/:bookId/acquisition')
  @Header('Cache-Control', 'no-store')
  async acquire(
    @CurrentParentId() parentId: string,
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('bookId', bookIdPipe) bookId: string,
  ): Promise<BookDetail> {
    return bookDetailSchema.parse(await this.libraryService.acquire(parentId, familyId, bookId));
  }

  /** 204, also when the family does not have the book. */
  @Delete('books/:bookId/acquisition')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentParentId() parentId: string,
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('bookId', bookIdPipe) bookId: string,
  ): Promise<void> {
    await this.libraryService.remove(parentId, familyId, bookId);
  }

  /** 200 with the book and its readers as set. */
  @Put('books/:bookId/readers')
  @Header('Cache-Control', 'no-store')
  async setReaders(
    @CurrentParentId() parentId: string,
    @Param('familyId', familyIdPipe) familyId: string,
    @Param('bookId', bookIdPipe) bookId: string,
    @Body(new ZodValidationPipe(setBookReadersRequestSchema)) body: SetBookReadersRequest,
  ): Promise<BookDetail> {
    return bookDetailSchema.parse(
      await this.libraryService.setReaders(parentId, familyId, bookId, body.childIds),
    );
  }
}
