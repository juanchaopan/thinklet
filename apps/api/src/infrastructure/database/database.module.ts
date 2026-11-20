import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { describeError } from '../logging/describe-error.js';
import * as schema from './schema.js';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
export const DATABASE = Symbol('DATABASE');

/** Drizzle over the pool; `$client` is the pg pool itself, for driver options Drizzle does not pass on. */
export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

/**
 * How long a query may wait for a connection, whether a new one or a free
 * one from the pool. Long enough for Neon to wake a suspended database
 * (under a second), and short enough to leave the health check's database
 * ping time for its query within the check's timeout.
 */
export const CONNECTION_TIMEOUT_MS = 3_500;

/**
 * One pg pool per process, built from DATABASE_URL. In staging the URL is
 * Neon's pooled endpoint, which pools in transaction mode: queries must not
 * rely on session state (SET, advisory locks, LISTEN) and must not use named
 * prepared statements. Drizzle's node-postgres driver sends unnamed
 * statements, which work in that mode.
 */
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const logger = new Logger('DatabasePool');
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        });
        // An idle client can fail when the server restarts or drops it; without
        // this listener the error would crash the process.
        pool.on('error', (error) => {
          logger.error({ error: describeError(error) }, 'Idle database client failed');
        });
        return pool;
      },
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): Database => drizzle({ client: pool, schema }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
