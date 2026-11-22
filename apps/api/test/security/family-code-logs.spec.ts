import request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { as, createFamily, signInParent } from '../support/families.js';

/** A logged request as the request log writes it. */
interface LoggedRequest {
  url?: unknown;
  headers?: Record<string, unknown>;
}

/** Every request the output logged. */
function loggedRequests(output: string): LoggedRequest[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { req?: LoggedRequest })
    .flatMap((entry) => (entry.req === undefined ? [] : [entry.req]));
}

/** The URL every logged request was written with. */
function loggedUrls(output: string): string[] {
  return loggedRequests(output).flatMap((req) => (typeof req.url === 'string' ? [req.url] : []));
}

/** The forms a family code takes in a page address: as written, in lower case and URL-encoded. */
function codeForms(code: string): string[] {
  return [
    code,
    code.toLowerCase(),
    encodeURIComponent(code),
    encodeURIComponent(`/join/${code}`),
    encodeURIComponent(`/join/${code.toLowerCase()}`),
  ];
}

// A family code lets whoever holds it apply to the family, so the logs must
// not hold it: not in the URL of a lookup, nor in the page address the
// browser sends along with each request made from the join dialog, which
// sits on /join/<code>, or from the home page a visitor who is not signed
// in is sent to, which carries the code in its returnTo parameter. The
// built api runs as a separate process and everything it writes is read,
// as the platform's log collector would.
describe('Logs of requests that carry a family code', () => {
  let started: BuiltAppWithServices;
  let output: string;
  let code: string;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api } = started;
    const admin = await signInParent(api);
    ({ code } = await createFamily(api, admin));
    const applicant = await signInParent(api);
    const joinPage = `${TEST_APP_ORIGIN}/join/${code}`;
    const homePage = `${TEST_APP_ORIGIN}/?returnTo=${encodeURIComponent(`/join/${code}`)}`;

    // A lookup that succeeds, one in another casing with the code in the
    // query too, one without a login and one with a method no route takes.
    await as(api, applicant).get(`/api/family-codes/${code}`).set('Referer', joinPage).expect(200);
    await as(api, applicant)
      .get(`/API/Family-Codes/${code.toLowerCase()}?code=${code}`)
      .set('Referer', joinPage);
    await request(api).get(`/api/family-codes/${code}`).set('Referer', homePage).expect(401);
    await as(api, applicant).post(`/api/family-codes/${code}`).set('Referer', joinPage).expect(404);

    // The other requests of the join dialog and of the home page.
    await as(api, applicant)
      .post('/api/join-requests', { code })
      .set('Referer', joinPage)
      .expect(201);
    await as(api, applicant).get('/api/me').set('Referer', joinPage).expect(200);
    await as(api, applicant).get('/api/join-requests').set('Referer', joinPage).expect(200);
    await request(api).get('/api/me').set('Referer', homePage).expect(401);

    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logs each lookup with the code replaced', () => {
    const lookups = loggedUrls(output).filter((url) => /^\/api\/family-codes\//i.test(url));

    expect(lookups.length).toBeGreaterThanOrEqual(4);
    for (const url of lookups) {
      expect(url).toMatch(/^\/api\/family-codes\/\[redacted\]$/i);
    }
  });

  it('logs the requests without the page address they came from', () => {
    const requests = loggedRequests(output);

    expect(requests.length).toBeGreaterThanOrEqual(8);
    for (const req of requests) {
      expect(req.headers).toBeDefined();
      expect(Object.keys(req.headers ?? {})).not.toContain('referer');
    }
  });

  it('contains the family code nowhere, in any form', () => {
    expect(code).not.toBe('');
    for (const form of codeForms(code)) {
      expect(output).not.toContain(form);
    }
  });
});
