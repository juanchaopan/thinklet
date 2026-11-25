import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataMigrationsService } from './data-migrations/data-migrations.service.js';
import { ChildDataModule } from './infrastructure/child-data/child-data.module.js';
import { dataMigrationEnvironmentSchema } from './infrastructure/config/data-migration-environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';

/**
 * What the data migration command runs on: its own configuration, which
 * asks only for the database and CHILD_DATA_KEY, the database, the child
 * data cipher and the migrations themselves.
 */
@Module({
  imports: [
    // Only process.env is read, as in the api: Task loads the local .env
    // file in development, and CD sets the variables elsewhere.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: dataMigrationEnvironmentSchema,
    }),
    DatabaseModule,
    ChildDataModule,
  ],
  providers: [DataMigrationsService],
})
export class MigrateDataModule {}
