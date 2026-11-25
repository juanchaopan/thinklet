import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildDataCipher } from '../infrastructure/child-data/child-data-cipher.js';
import type { DataMigrationEnvironment } from '../infrastructure/config/data-migration-environment.js';
import { DATABASE, type Database } from '../infrastructure/database/database.module.js';
import { applyDataMigrations } from './apply-data-migrations.js';
import { registeredDataMigrations } from './registry.js';

/** The registered data migrations, run on the database with the infrastructure they use. */
@Injectable()
export class DataMigrationsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly cipher: ChildDataCipher,
    private readonly config: ConfigService<DataMigrationEnvironment, true>,
  ) {}

  /**
   * Runs the registered migrations that have not run yet, with the
   * checksums of their files in the source directory, and returns their
   * names.
   */
  apply(sourceDirectory: string): Promise<string[]> {
    return applyDataMigrations({
      database: this.database,
      migrations: registeredDataMigrations,
      sourceDirectory,
      context: {
        cipher: this.cipher,
        childDataKey: this.config.get('CHILD_DATA_KEY', { infer: true }),
      },
    });
  }
}
