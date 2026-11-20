import type { NestExpressApplication } from '@nestjs/platform-express';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { healthResponseSchema } from '@thinklet/contracts';
import request from 'supertest';
import { startApp } from '../support/app.js';
import {
  apiEnvironment,
  migrate,
  startDatabase,
  startStorage,
  type StartedStorage,
} from '../support/containers.js';

describe('GET /api/health', () => {
  let database: StartedPostgreSqlContainer;
  let storage: StartedStorage;

  beforeAll(async () => {
    [database, storage] = await Promise.all([startDatabase(), startStorage()]);
    await migrate(database.getConnectionUri());
  });

  afterAll(async () => {
    await Promise.all([database?.stop(), storage?.container.stop()]);
  });

  describe('with the database and the bucket up', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await startApp(apiEnvironment(database.getConnectionUri(), storage));
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
        checks: { database: 'ok', storage: 'ok' },
      });
    });
  });

  describe('with the bucket missing', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await startApp(
        apiEnvironment(database.getConnectionUri(), { ...storage, bucket: 'missing-bucket' }),
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the storage check marked', async () => {
      const response = await request(app.getHttpServer()).get('/api/health');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        checks: { database: 'ok', storage: 'error' },
      });
    });
  });

  describe('with the database stopped', () => {
    let stoppedDatabase: StartedPostgreSqlContainer;
    let app: NestExpressApplication;

    beforeAll(async () => {
      stoppedDatabase = await startDatabase();
      app = await startApp(apiEnvironment(stoppedDatabase.getConnectionUri(), storage));
      await stoppedDatabase.stop();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('returns 503 with the database check marked', async () => {
      const response = await request(app.getHttpServer()).get('/api/health');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        checks: { database: 'error', storage: 'ok' },
      });
    });
  });
});
