import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { healthResponseSchema, type HealthResponse } from '@thinklet/contracts';
import request from 'supertest';
import { CHECK_TIMEOUT_MS } from '../../src/modules/health/health.service.js';
import { startApp } from '../support/app.js';
import {
  accessTo,
  apiEnvironment,
  migrate,
  startDatabase,
  startRedis,
  startServices,
  type ServiceAccess,
  type StartedRedis,
  type StartedServices,
} from '../support/containers.js';
import { freePort } from '../support/process.js';

const docker = (...args: string[]) => promisify(execFile)('docker', args);

/** Asserts that GET /api/health answers 503 with the given result of each check. */
async function expectUnavailable(
  app: NestExpressApplication,
  checks: HealthResponse['checks'],
): Promise<void> {
  const response = await request(app.getHttpServer()).get('/api/health');

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'error', checks });
}

/** Asserts that the ping fails and how long it took is under the health check's timeout. */
async function expectPingFailsInTime(ping: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await expect(ping()).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(CHECK_TIMEOUT_MS);
}

/** The checks of an api whose Redis alone fails. */
const REDIS_FAILED = { database: 'ok', storage: 'ok', redis: 'error' } as const;

describe('GET /api/health', () => {
  let services: StartedServices;

  /** The api's environment with the started services, but for the ones given. */
  const environmentWith = (changes: Partial<ServiceAccess>) =>
    apiEnvironment({ ...accessTo(services), ...changes });

  /**
   * Starts an api on a Redis of its own and waits until its health check
   * passes, so the api is connected before a test breaks that Redis.
   */
  async function startOnOwnRedis(): Promise<{ redis: StartedRedis; app: NestExpressApplication }> {
    const redis = await startRedis();
    const app = await startApp(environmentWith({ redisUrl: redis.url }));
    await request(app.getHttpServer()).get('/api/health').expect(200);
    return { redis, app };
  }

  beforeAll(async () => {
    services = await startServices();
    await migrate(services.database.getConnectionUri());
  });

  afterAll(async () => {
    await services?.stop();
  });

  describe('with the database, the bucket and Redis up', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await startApp(environmentWith({}));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 200 with every check ok', async () => {
      const response = await request(app.getHttpServer()).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(healthResponseSchema.parse(response.body)).toEqual({
        status: 'ok',
        checks: { database: 'ok', storage: 'ok', redis: 'ok' },
      });
    });
  });

  describe('with the bucket missing', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await startApp(
        environmentWith({ storage: { ...services.storage, bucket: 'missing-bucket' } }),
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the storage check marked', async () => {
      await expectUnavailable(app, { database: 'ok', storage: 'error', redis: 'ok' });
    });
  });

  describe('with the database stopped', () => {
    let stoppedDatabase: StartedPostgreSqlContainer;
    let app: NestExpressApplication;

    beforeAll(async () => {
      stoppedDatabase = await startDatabase();
      app = await startApp(environmentWith({ databaseUrl: stoppedDatabase.getConnectionUri() }));
      await stoppedDatabase.stop();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the database check marked', async () => {
      await expectUnavailable(app, { database: 'error', storage: 'ok', redis: 'ok' });
    });
  });

  describe('with Redis unreachable from the start', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      const closedPort = await freePort();
      app = await startApp(environmentWith({ redisUrl: `redis://127.0.0.1:${closedPort}` }));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the Redis check marked', async () => {
      await expectUnavailable(app, REDIS_FAILED);
    });
  });

  describe('with Redis stopped after the api connected', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      const started = await startOnOwnRedis();
      app = started.app;
      await started.redis.container.stop();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the Redis check marked', async () => {
      await expectUnavailable(app, REDIS_FAILED);
    });
  });

  // A paused container still accepts connections but never answers, like a
  // database that hangs: the ping must end on its own before the check's
  // timeout, so pings do not pile up in the pool while it lasts.
  describe('with the database not answering', () => {
    let hungDatabase: StartedPostgreSqlContainer;
    let app: NestExpressApplication;
    let paused = false;

    beforeAll(async () => {
      hungDatabase = await startDatabase();
      app = await startApp(environmentWith({ databaseUrl: hungDatabase.getConnectionUri() }));
      // An answered check leaves an open connection in the pool.
      await request(app.getHttpServer()).get('/api/health').expect(200);
      await docker('pause', hungDatabase.getId());
      paused = true;
    });

    afterAll(async () => {
      if (paused) {
        await docker('unpause', hungDatabase.getId());
      }
      await app?.close();
      await hungDatabase?.stop();
    });

    it('ends the database ping before the check times out, on an open and on a new connection', async () => {
      // The repository is taken from the application's own module instances.
      const { HealthRepository } = await import('../../src/modules/health/health.repository.js');
      const repository = app.get(HealthRepository);

      // The first ping waits on the open connection, which the failed query
      // discards; the second has to open a new one.
      await expectPingFailsInTime(() => repository.ping());
      await expectPingFailsInTime(() => repository.ping());
    });
  });

  // Redis that hangs the same way: its PING gives up by its own timeout.
  describe('with Redis not answering', () => {
    let hungRedis: StartedRedis | undefined;
    let app: NestExpressApplication;
    let paused = false;

    beforeAll(async () => {
      const started = await startOnOwnRedis();
      ({ redis: hungRedis, app } = started);
      await docker('pause', started.redis.container.getId());
      paused = true;
    });

    afterAll(async () => {
      if (paused && hungRedis !== undefined) {
        await docker('unpause', hungRedis.container.getId());
      }
      await app?.close();
      await hungRedis?.container.stop();
    });

    it('ends the PING before the check times out and answers 503', async () => {
      const { RedisService } = await import('../../src/infrastructure/redis/redis.service.js');
      const redis = app.get(RedisService);

      await expectPingFailsInTime(() => redis.ping());
      await expectUnavailable(app, REDIS_FAILED);
    });
  });
});
