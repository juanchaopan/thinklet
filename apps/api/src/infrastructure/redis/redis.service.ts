import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import type { Environment } from '../config/environment.js';
import { describeError } from '../logging/describe-error.js';

/**
 * How long a command may wait to be sent and for its answer. A login waits
 * on the rate limits' commands, so a Redis that hangs costs it this much at
 * most; it is also under the health check's 5 seconds.
 */
export const COMMAND_TIMEOUT_MS = 2_000;

export type RedisClient = ReturnType<typeof createClient>;

/** A command refused at once because the connection to Redis failed and has not come back. */
export class RedisUnavailableError extends Error {
  override readonly name = 'RedisUnavailableError';

  constructor() {
    super('Redis is not reachable');
  }
}

/**
 * The api's one connection to Redis (node-redis over the standard
 * protocol), at REDIS_URL. It connects in the background when the
 * application starts, so the api starts and answers while Redis is down,
 * and node-redis keeps reconnecting after a failure.
 *
 * Commands run through `run`. While the first connection is being made
 * they wait for it; once a connection has failed, and until one is made
 * again, they are refused at once with RedisUnavailableError rather than
 * each waiting out the timeout. Every command gives up after
 * COMMAND_TIMEOUT_MS, sent or not. The failure of a connection is logged
 * once, when it starts, and its end once, when a connection is made again;
 * the address is never logged.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClient;
  private unreachable = false;

  constructor(config: ConfigService<Environment, true>) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      socket: { connectTimeout: COMMAND_TIMEOUT_MS },
      commandOptions: { timeout: COMMAND_TIMEOUT_MS, rejectInFlight: true },
    });
    // Without a listener, node-redis's error event would end the process.
    this.client.on('error', (error: unknown) => {
      if (!this.unreachable) {
        this.unreachable = true;
        this.logger.error({ error: describeError(error) }, 'Redis connection failed');
      }
    });
    this.client.on('ready', () => {
      if (this.unreachable) {
        this.unreachable = false;
        this.logger.log('Redis connection restored');
      }
    });
  }

  onModuleInit(): void {
    // node-redis retries a failed connection by itself, reporting each
    // failure on the error event; the promise only settles once a
    // connection is made or the client is shut down.
    this.client.connect().catch(() => undefined);
  }

  onApplicationShutdown(): void {
    if (this.client.isOpen) {
      this.client.destroy();
    }
  }

  /** Runs commands on the connection; refused at once while Redis is unreachable. */
  async run<T>(commands: (client: RedisClient) => Promise<T>): Promise<T> {
    if (this.unreachable) {
      throw new RedisUnavailableError();
    }
    return commands(this.client);
  }

  /** Resolves when Redis answers PING; rejects on an error, the timeout or while it is unreachable. */
  async ping(): Promise<void> {
    await this.run((client) => client.ping());
  }
}
