import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';

@Injectable()
export class HealthRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Resolves when the database answers a trivial query. */
  async ping(): Promise<void> {
    await this.database.execute(sql`select 1`);
  }
}
