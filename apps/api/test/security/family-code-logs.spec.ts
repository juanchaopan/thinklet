import request from 'supertest';
import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { as, createFamily, signInParent } from '../support/families.js';

/** The URL every logged request was written with. */
function loggedUrls(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { req?: { url?: unknown } })
    .flatMap((entry) => (typeof entry.req?.url === 'string' ? [entry.req.url] : []));
}

// A family code lets whoever holds it apply to the family, so the logs of
// a lookup must not hold it. The built api runs as a separate process and
// everything it writes is read, as the platform's log collector would.
describe('Logs of a family code lookup', () => {
  let started: BuiltAppWithServices;
  let output: string;
  let code: string;

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api } = started;
    const admin = await signInParent(api);
    ({ code } = await createFamily(api, admin));
    const applicant = await signInParent(api);

    // A lookup that succeeds, one in another casing with the code in the
    // query too, one without a login and one with a method no route takes.
    await as(api, applicant).get(`/api/family-codes/${code}`).expect(200);
    await as(api, applicant).get(`/API/Family-Codes/${code.toLowerCase()}?code=${code}`);
    await request(api).get(`/api/family-codes/${code}`).expect(401);
    await as(api, applicant).post(`/api/family-codes/${code}`).expect(404);

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

  it('contains the family code nowhere', () => {
    expect(code).not.toBe('');
    expect(output).not.toContain(code);
    expect(output).not.toContain(code.toLowerCase());
  });
});
