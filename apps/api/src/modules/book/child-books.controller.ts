import { Controller, Get, Header } from '@nestjs/common';
import { childBooksResponseSchema, type ChildBooksResponse } from '@thinklet/contracts';
import { CurrentChildId } from '../../infrastructure/authentication/current-child.js';
import { ForSignedInChild } from './book-reader.guard.js';
import { ChildBooksService } from './child-books.service.js';

/**
 * The books of the signed-in child (`.docs/design/interfaces.md`,
 * "孩子（孩子登录后）"). Every route passes the child's login check first.
 */
@Controller('child')
@ForSignedInChild()
export class ChildBooksController {
  constructor(private readonly childBooksService: ChildBooksService) {}

  /** Every book assigned to the child, at once, latest assignment first. */
  @Get('books')
  @Header('Cache-Control', 'no-store')
  async books(@CurrentChildId() childId: string): Promise<ChildBooksResponse> {
    return childBooksResponseSchema.parse(await this.childBooksService.books(childId));
  }
}
