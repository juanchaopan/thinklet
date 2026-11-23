import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { rebuildEnvironmentSchema } from './infrastructure/config/rebuild-environment.js';
import { CoverImportModule } from './modules/book/cover-import.module.js';

/**
 * What the cover import command runs on: its own configuration, which asks
 * only for the database and storage, and the cover import with those two.
 */
@Module({
  imports: [
    // Only process.env is read, as in the api: Task loads the local .env
    // file in development, and CD sets the variables elsewhere.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: rebuildEnvironmentSchema,
    }),
    CoverImportModule,
  ],
})
export class RebuildModule {}
