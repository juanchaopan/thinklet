import request from 'supertest';
import { runBuiltApp, type RunningProcess } from '../support/app.js';
import {
  apiEnvironment,
  startServices,
  testSigningKey,
  type StartedServices,
} from '../support/containers.js';
import { freePort, waitForHttp } from '../support/process.js';

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** The private part of the test signing key, which must never be logged. */
const signingKeySecret = (JSON.parse(testSigningKey) as { d: string }).d;

// These tests run the built dist/main.js as a separate process and read
// everything it writes, exactly as the platform's log collector would.
describe('Logs', () => {
  let services: StartedServices;

  beforeAll(async () => {
    services = await startServices();
  });

  afterAll(async () => {
    await services?.stop();
  });

  describe('when the checks fail on wrong credentials', () => {
    const authorization = `Bearer token-${crypto.randomUUID()}`;
    const cookie = `session=cookie-${crypto.randomUUID()}`;
    let environment: Record<string, string>;
    let running: RunningProcess;
    let lines: string[];

    beforeAll(async () => {
      const port = await freePort();
      const url = new URL(services.database.getConnectionUri());
      url.password = `wrong-${crypto.randomUUID()}`;
      environment = {
        ...apiEnvironment(
          url.toString(),
          { ...services.storage, secretAccessKey: `wrong-${crypto.randomUUID()}` },
          services.oidc,
        ),
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

    it('contains no connection string, credentials, signing key, authorization header or cookie', () => {
      const output = lines.join('\n');
      const url = new URL(environment['DATABASE_URL'] ?? '');
      const secrets = [
        environment['DATABASE_URL'],
        url.password,
        environment['S3_ACCESS_KEY_ID'],
        environment['S3_SECRET_ACCESS_KEY'],
        environment['OIDC_CLIENT_SECRET'],
        signingKeySecret,
        authorization,
        cookie,
      ];

      for (const secret of secrets) {
        expect(secret).toBeTruthy();
        expect(output).not.toContain(secret);
      }
      expect(output).not.toMatch(/postgres(ql)?:\/\//);
      expect(output).not.toContain(services.storage.endpoint);
    });
  });

  it('refuses to start on an invalid variable, naming it without its value', async () => {
    const invalidValue = `not-a-url-${crypto.randomUUID()}`;
    const running = runBuiltApp({
      ...apiEnvironment(invalidValue, services.storage, services.oidc),
      PORT: String(await freePort()),
    });

    const exitCode = await running.exited;

    expect(exitCode).not.toBe(0);
    expect(running.output()).toContain('DATABASE_URL');
    for (const secret of [
      invalidValue,
      services.storage.secretAccessKey,
      services.oidc.clientSecret,
      signingKeySecret,
    ]) {
      expect(running.output()).not.toContain(secret);
    }
  });

  it('refuses to start on a signing key that is not one, naming it without its value', async () => {
    const running = runBuiltApp({
      ...apiEnvironment(services.database.getConnectionUri(), services.storage, services.oidc),
      JWT_SIGNING_KEY: testSigningKey.slice(0, -10),
      PORT: String(await freePort()),
    });

    const exitCode = await running.exited;

    expect(exitCode).not.toBe(0);
    expect(running.output()).toContain('JWT_SIGNING_KEY');
    expect(running.output()).not.toContain(signingKeySecret);
  });
});
