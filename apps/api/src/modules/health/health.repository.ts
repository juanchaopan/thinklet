import { Inject, Injectable } from '@nestjs/common';
import type { QueryConfig } from 'pg';
import { DATABASE, type Database } from '../../infrastructure/database/database.module.js';

/**
 * How long the ping's query may take once it has a connection. With the
 * pool's connection timeout it keeps the whole ping within the health
 * check's timeout, so pings do not pile up while the database is down.
 */
export const PING_QUERY_TIMEOUT_MS = 1_000;

/**
 * pg honours `query_timeout` on a single query (it ends the query and
 * discards its connection); its type definitions list it only for a whole
 * client, so the query type adds it here.
 */
type TimedQuery = QueryConfig & { query_timeout: number };

const PING: TimedQuery = { text: 'select 1', query_timeout: PING_QUERY_TIMEOUT_MS };

@Injectable()
export class HealthRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Resolves when the database answers a trivial query; rejects on an error or the timeout. */
  async ping(): Promise<void> {
    await this.database.$client.query(PING);
  }
}
