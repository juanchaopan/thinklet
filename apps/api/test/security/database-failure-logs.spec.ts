import { startBuiltAppWithServices, type BuiltAppWithServices } from '../support/app.js';
import { query } from '../support/database.js';
import { as, createFamily, signInParent } from '../support/families.js';
import { authorize, callback, newUser, startLogin } from '../support/login.js';

const tag = () => crypto.randomUUID().slice(0, 8);

/** The SQLSTATE the failing writes raise: a canceled statement, as a statement timeout reports. */
const FAILURE_CODE = '57014';

/**
 * Makes every insert and update of the table fail as the database reports
 * it, with the row's values in the message and in the detail, as a
 * constraint's error quotes the values it rejects.
 */
function failWrites(table: string): string[] {
  return [
    `create or replace function fail_writes() returns trigger language plpgsql as $$
     begin
       raise exception 'rejected %', row_to_json(new)
         using errcode = '${FAILURE_CODE}', detail = row_to_json(new)::text;
     end $$`,
    `create trigger fail_writes before insert or update on ${table}
     for each row execute function fail_writes()`,
  ];
}

/** Each JSON line the api wrote. */
function entriesOf(output: string): Array<Record<string, unknown>> {
  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// Acceptance criterion: the logs hold no parent's name or email and no
// family code (.docs/design/data.md), also when the database fails. Every
// query that fails here carries them as its parameters: the writes fail by
// a trigger and the code lookup by a missing table, during real requests to
// the built api, which runs as a separate process whose every written line
// is read, as the platform's log collector would.
describe('Logs of requests whose database queries fail', () => {
  let started: BuiltAppWithServices;
  let output: string;
  let code: string;
  const personal = {
    editedName: `悦悦${tag()}`,
    familyName: `林家${tag()}`,
    loginName: `周子航${tag()}`,
    loginEmail: `parent-${tag()}@example.com`,
  };

  beforeAll(async () => {
    started = await startBuiltAppWithServices();
    const { api, services } = started;
    const databaseUrl = services.database.getConnectionUri();
    const admin = await signInParent(api);
    ({ code } = await createFamily(api, admin));
    const applicant = await signInParent(api);

    for (const table of ['parents', 'families', 'join_requests']) {
      for (const statement of failWrites(table)) {
        await query(databaseUrl, statement);
      }
    }

    await as(api, admin).patch('/api/me', { name: personal.editedName }).expect(500);
    await as(api, admin)
      .post('/api/families', { name: personal.familyName, timezone: 'Asia/Shanghai' })
      .expect(500);
    await as(api, applicant).post('/api/join-requests', { code }).expect(500);
    const { authorizationUrl, loginCookie } = await startLogin(api);
    const callbackPath = await authorize(
      authorizationUrl,
      newUser({ name: personal.loginName, email: personal.loginEmail }),
    );
    await callback(api, callbackPath, loginCookie).expect(302).expect('Location', '/?login=failed');

    await query(databaseUrl, 'alter table families rename to families_unavailable');
    await as(api, applicant).get(`/api/family-codes/${code}`).expect(500);

    output = await started.stopApp();
  });

  afterAll(async () => {
    await started?.stop();
  });

  it('logs each failure by the error class and SQLSTATE', () => {
    const failures = entriesOf(output).filter(
      (entry) => entry['msg'] === 'Unexpected error' || entry['msg'] === 'Login failed',
    );

    expect(failures.filter((entry) => entry['msg'] === 'Unexpected error')).toHaveLength(4);
    expect(failures.filter((entry) => entry['msg'] === 'Login failed')).toHaveLength(1);
    for (const entry of failures) {
      expect(entry['error']).toMatchObject({
        name: 'DrizzleQueryError',
        causes: [{ name: 'DatabaseError', code: expect.stringMatching(/^[0-9A-Z]{5}$/) }],
      });
    }
    expect(JSON.stringify(failures)).toContain(FAILURE_CODE);
  });

  it('contain neither the SQL nor the parameters of a failed query', () => {
    expect(output).not.toContain('Failed query');
    expect(output).not.toContain('params:');
    expect(output).not.toContain('Key (');
  });

  it("contain no parent's name or email, no family's name and no family code", () => {
    expect(code).not.toBe('');
    for (const value of [...Object.values(personal), code, code.toLowerCase()]) {
      expect(output).not.toContain(value);
    }
  });
});
