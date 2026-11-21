import request from 'supertest';
import { runBuiltApp, type RunningProcess } from '../support/app.js';
import {
  apiEnvironment,
  migrate,
  startServices,
  TEST_APP_ORIGIN,
  type StartedServices,
} from '../support/containers.js';
import { authorize, callback, cookieHeader, setCookiesOf, startLogin } from '../support/login.js';
import { freePort, waitForHttp } from '../support/process.js';

const tag = () => crypto.randomUUID().slice(0, 8);

// Acceptance criterion: the logs hold no parent's name or email, and no
// token or cookie of the login. The built api runs as a separate process
// and everything it writes is read, as the platform's log collector would.
describe('Logs of a login', () => {
  let services: StartedServices;
  let running: RunningProcess;
  let output: string;
  const personal = {
    name: `林悦${tag()}`,
    email: `parent-${tag()}@example.com`,
    editedName: `悦悦${tag()}`,
  };
  const secrets: Record<string, string> = {};

  beforeAll(async () => {
    services = await startServices();
    await migrate(services.database.getConnectionUri());
    const port = await freePort();
    running = runBuiltApp({
      ...apiEnvironment(services.database.getConnectionUri(), services.storage, services.oidc),
      PORT: String(port),
    });
    await waitForHttp(running, port);
    const api = `http://127.0.0.1:${port}`;

    const { authorizationUrl, loginCookie } = await startLogin(api, '/profile');
    const callbackPath = await authorize(authorizationUrl, {
      subject: `user-${tag()}`,
      claims: { name: personal.name, email: personal.email },
    });
    const signedIn = setCookiesOf(await callback(api, callbackPath, loginCookie));
    const cookies = {
      thinklet_session: signedIn['thinklet_session']?.value ?? '',
      thinklet_id_token: signedIn['thinklet_id_token']?.value ?? '',
    };
    const callbackQuery = new URL(callbackPath, TEST_APP_ORIGIN).searchParams;
    Object.assign(secrets, {
      loginCookie,
      code: callbackQuery.get('code') ?? '',
      state: callbackQuery.get('state') ?? '',
      nonce: authorizationUrl.searchParams.get('nonce') ?? '',
      codeChallenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
      ...cookies,
    });

    await request(api).get('/api/me').set('Cookie', cookieHeader(cookies)).expect(200);
    await request(api)
      .patch('/api/me')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Cookie', cookieHeader(cookies))
      .send({ name: personal.editedName })
      .expect(200);
    // A replayed callback fails, so the failure's reason is logged too.
    await callback(api, callbackPath, loginCookie).expect(302);
    await request(api)
      .post('/api/auth/logout')
      .set('Origin', TEST_APP_ORIGIN)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    running.child.kill();
    await running.exited;
    output = running.output();
  });

  afterAll(async () => {
    running?.child.kill();
    await services?.stop();
  });

  it('logs the requests and why a login failed', () => {
    const entries = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(entries.some((entry) => entry['msg'] === 'Login failed')).toBe(true);
    expect(
      entries.some(
        (entry) => (entry['req'] as { url?: unknown } | undefined)?.url === '/api/auth/callback',
      ),
    ).toBe(true);
  });

  it("contain no parent's name or email", () => {
    for (const value of Object.values(personal)) {
      expect(output).not.toContain(value);
    }
  });

  it('contain no token, code, state or cookie of the login', () => {
    for (const [name, value] of Object.entries(secrets)) {
      expect(value, name).not.toBe('');
      expect(output, name).not.toContain(value);
    }
  });
});
