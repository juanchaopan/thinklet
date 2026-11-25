import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChildModule } from '../child/child.module.js';
import { FamilyModule } from '../family/family.module.js';
import { BookFamilyGuard } from './book-family.guard.js';
import { BookReaderGuard } from './book-reader.guard.js';
import { BooksRepository } from './books.repository.js';
import { ChildBooksController } from './child-books.controller.js';
import { ChildBooksService } from './child-books.service.js';
import { CoverController } from './cover.controller.js';
import { CoverService } from './cover.service.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';

/**
 * The library and its books. LibraryService serves a family's parents: the
 * library list and its filters, a book's page, acquiring and removing a
 * book and setting the children who read it, each change recorded with the
 * audit module; its routes pass the family module's membership check, and
 * it looks up the family's children through the child module.
 * ChildBooksService serves the signed-in child's own books, and
 * CoverService the covers, which a signed-in parent or child may read;
 * their routes pass BookReaderGuard, made of the auth and child modules'
 * login checks. The cover import, which the import command runs on its
 * own, is in CoverImportModule.
 */
@Module({
  imports: [DatabaseModule, StorageModule, AuditModule, AuthModule, FamilyModule, ChildModule],
  controllers: [LibraryController, CoverController, ChildBooksController],
  providers: [
    BooksRepository,
    LibraryService,
    CoverService,
    ChildBooksService,
    BookFamilyGuard,
    BookReaderGuard,
  ],
})
export class BookModule {}
