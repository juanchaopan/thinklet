import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { runBuiltApp, type RunningProcess } from '../support/app.js';
import {
  apiEnvironment,
  startDatabase,
  startStorage,
  type StartedStorage,
} from '../support/containers.js';
import { freePort, waitForHttp } from '../support/process.js';

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

// These tests run the built dist/main.js as a separate process and read
// everything it writes, exactly as the platform's log collector would.
describe('Logs', () => {
  let database: StartedPostgreSqlContainer;
  let storage: StartedStorage;

  beforeAll(async () => {
    [database, storage] = await Promise.all([startDatabase(), startStorage()]);
  });

  afterAll(async () => {
    await Promise.all([database?.stop(), storage?.container.stop()]);
  });

  describe('when the checks fail on wrong credentials', () => {
    const authorization = `Bearer token-${crypto.randomUUID()}`;
    const cookie = `session=cookie-${crypto.randomUUID()}`;
    let environment: Record<string, string>;
    let running: RunningProcess;
    let lines: string[];

    beforeAll(async () => {
      const port = await freePort();
      const url = new URL(database.getConnectionUri());
      url.password = `wrong-${crypto.randomUUID()}`;
      environment = {
        ...apiEnvironment(url.toString(), {
          ...storage,
          secretAccessKey: `wrong-${crypto.randomUUID()}`,
        }),
        PORT: String(port),
      };
      running = runBuiltApp(environment);
      await waitForHttp(running, port);

      const response = await request(`http://127.0.0.1:${port}`)
        .get('/api/health')
        .set('Authorization', authorization)
        .set('Cookie', cookie);
      expect(response.status).toBe(503);

      running.child.kill();
      await running.exited;
      lines = nonEmptyLines(running.output());
    });

    it('writes one JSON object per line', () => {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line) as unknown).not.toThrow();
      }
    });

    it('logs which check failed and tags the request with an id', () => {
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const failures = entries.filter((entry) => entry['msg'] === 'Health check failed');

      expect(failures.map((entry) => entry['check']).sort()).toEqual(['database', 'storage']);
      for (const failure of failures) {
        expect(failure['req']).toMatchObject({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      }
    });

    it('contains no connection string, credentials, authorization header or cookie', () => {
      const output = lines.join('\n');
      const url = new URL(environment['DATABASE_URL'] ?? '');
      const secrets = [
        environment['DATABASE_URL'],
        url.password,
        environment['S3_ACCESS_KEY_ID'],
        environment['S3_SECRET_ACCESS_KEY'],
        authorization,
        cookie,
      ];

      for (const secret of secrets) {
        expect(secret).toBeTruthy();
        expect(output).not.toContain(secret);
      }
      expect(output).not.toMatch(/postgres(ql)?:\/\//);
      expect(output).not.toContain(storage.endpoint);
    });
  });

  it('refuses to start on an invalid variable, naming it without its value', async () => {
    const invalidValue = `not-a-url-${crypto.randomUUID()}`;
    const running = runBuiltApp({
      ...apiEnvironment(invalidValue, storage),
      PORT: String(await freePort()),
    });

    const exitCode = await running.exited;

    expect(exitCode).not.toBe(0);
    expect(running.output()).toContain('DATABASE_URL');
    expect(running.output()).not.toContain(invalidValue);
    expect(running.output()).not.toContain(storage.secretAccessKey);
  });
});
