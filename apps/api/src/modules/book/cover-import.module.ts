import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { CoverImportRepository } from './cover-import.repository.js';
import { CoverImportService } from './cover-import.service.js';

/**
 * The cover import on its own, with nothing but the database and storage,
 * so the import command (rebuild.ts) starts no more of the api than it uses.
 */
@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [CoverImportRepository, CoverImportService],
  exports: [CoverImportService],
})
export class CoverImportModule {}
