import { createHash } from 'node:crypto';
import { errorResponseSchema, type FamilyDetail } from '@thinklet/contracts';
import request from 'supertest';
import {
  CHILD_SESSION_COOKIE,
  ChildBrowser,
  DEVICE_COOKIE,
  addChildWithPassword,
  linkPath,
  newLoginLink,
  type ChildWithPassword,
} from '../support/child-login.js';
import { addChild, childrenPath, deviceRows } from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader, setCookiesOf } from '../support/login.js';

/** A combining accent: two bytes of UTF-8 that add no character. */
const ACUTE = String.fromCodePoint(0x301);

/**
 * Passwords no child can have: past 32 characters, past 128 bytes in seven
 * characters, and as long as a request body may carry.
 */
const PASSWORDS_PAST_THE_LIMITS: Array<[string, string]> = [
  ['33 characters', 'a'.repeat(33)],
  ['129 bytes', `abcdefg${ACUTE.repeat(61)}`],
  ['50 000 characters', 'a'.repeat(50_000)],
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** What a response tells: its status, the fields and code of its error, and the cookies it sets. */
function whatItTells(response: request.Response) {
  const { error } = errorResponseSchema.parse(response.body);
  return {
    status: response.status,
    fields: Object.keys(error).sort(),
    code: error.code,
    cookies: response.headers['set-cookie'],
  };
}

/** A login that remembers a child on the browser, and the child it logged in. */
interface RememberingLogin {
  childId: string;
  response: request.Response;
}

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for a
// child's login: a failed login does not say which item was wrong; a
// password past the limits is refused like a wrong one, and cannot be set;
// a child's login opens no parent route and a parent's login no child
// route; one child's remembered browser does not log in another child; a
// device token written into the browser that the api never issued does
// not become a device credential (#14, 18); the routes that change data
// need this site's Origin, though they need no login.
describe('child login security', () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;
  let child: ChildWithPassword;

  const browser = () => new ChildBrowser(running.server);
  const loginOf = (who: ChildWithPassword, remember = false) => ({
    code: family.code,
    account: who.account,
    password: who.password,
    remember,
  });
  /** Whether the link of the token can still be used: opening it answers who it is for. */
  const stillUsable = async (token: string) =>
    (await browser().get(linkPath(token))).status === 200;
  /** How many devices of any child the database has with the token's hash. */
  const devicesWithToken = async (token: string) =>
    (
      await query<{ id: string }>(
        running.databaseUrl,
        'select id from child_devices where token_hash = $1',
        [sha256(token)],
      )
    ).length;

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    family = await createFamily(running.server, parent);
    child = await addChildWithPassword(running.server, parent, family.id);
  });

  it('answers a wrong code, account or password and a child without a password alike', async () => {
    const other = await createFamily(running.server, parent);
    const noPassword = await addChild(running.server, parent, family.id);
    const login = loginOf(child);

    const answers = await Promise.all(
      [
        { ...login, code: other.code },
        { ...login, account: `${child.account}0` },
        { ...login, password: `${child.password}0` },
        { ...login, account: noPassword.account },
      ].map(async (body) => whatItTells(await browser().login(body))),
    );

    expect(answers).toEqual(
      answers.map(() => ({
        status: 401,
        fields: ['code', 'requestId'],
        code: 'login_failed',
        cookies: undefined,
      })),
    );
  });

  describe('a password past the limits', () => {
    it.each(PASSWORDS_PAST_THE_LIMITS)(
      'of %s is answered at login as a wrong password, signing nobody in',
      async (_name, password) => {
        const response = await browser().login({ ...loginOf(child), password });

        expect(whatItTells(response)).toEqual({
          status: 401,
          fields: ['code', 'requestId'],
          code: 'login_failed',
          cookies: undefined,
        });
      },
    );

    it.each(PASSWORDS_PAST_THE_LIMITS)(
      'of %s is a wrong password on a login link, which stays usable',
      async (_name, password) => {
        const { token } = await newLoginLink(running.server, parent, family.id, child.id);
        const kid = browser();

        const refused = await kid.post(`${linkPath(token)}/login`, { password, remember: false });

        expect(whatItTells(refused)).toEqual({
          status: 401,
          fields: ['code', 'requestId'],
          code: 'wrong_password',
          cookies: undefined,
        });
        const accepted = await kid.post(`${linkPath(token)}/login`, {
          password: child.password,
          remember: false,
        });
        expect(accepted.status).toBe(200);
      },
    );

    it('cannot be set as a first password, which leaves the link unused', async () => {
      const fresh = await addChild(running.server, parent, family.id);
      const { token } = await newLoginLink(running.server, parent, family.id, fresh.id);
      const kid = browser();

      const answers = [];
      for (const [, password] of PASSWORDS_PAST_THE_LIMITS) {
        const answer = await kid.post(`${linkPath(token)}/password`, { password, remember: true });
        answers.push({
          status: answer.status,
          fields: errorResponseSchema.parse(answer.body).error.fields,
          cookies: answer.headers['set-cookie'],
        });
      }

      expect(answers).toEqual(
        PASSWORDS_PAST_THE_LIMITS.map(() => ({
          status: 400,
          fields: [{ path: 'password', code: 'too_long' }],
          cookies: undefined,
        })),
      );
      expect(await stillUsable(token)).toBe(true);
    });
  });

  describe("a child's login", () => {
    let kid: ChildBrowser;

    beforeAll(async () => {
      kid = browser();
      expect((await kid.login(loginOf(child))).status).toBe(200);
    });

    it.each<[string, string]>([
      ['GET', '/api/me'],
      ['GET', '/api/join-requests'],
      ['GET', '/api/families/{familyId}'],
      ['GET', '/api/families/{familyId}/children'],
      ['POST', '/api/families/{familyId}/children'],
    ])('opens no parent route: %s %s is 401 unauthenticated', async (method, template) => {
      const path = template.replace('{familyId}', family.id);
      const response =
        method === 'GET'
          ? await kid.get(path)
          : await kid.post(path, { nickname: '被加了', account: 'added', consent: true });

      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
    });

    it("opens no parent route in the parent's cookie either", async () => {
      const response = await request(running.server)
        .get(childrenPath(family.id))
        .set(
          'Cookie',
          cookieHeader({ thinklet_session: kid.cookies.get(CHILD_SESSION_COOKIE) ?? '' }),
        );

      expect(response.status).toBe(401);
    });
  });

  describe("a parent's login", () => {
    it.each<[string, () => Record<string, string>]>([
      ["in the parent's cookie", () => parent.cookies],
      [
        "in the child's cookie",
        () => ({ [CHILD_SESSION_COOKIE]: parent.cookies['thinklet_session'] ?? '' }),
      ],
    ])('opens no child route %s', async (_case, cookies) => {
      const response = await request(running.server)
        .get('/api/child/me')
        .set('Cookie', cookieHeader(cookies()));

      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
    });
  });

  it("does not log in another child with one child's remembered browser", async () => {
    const sibling = await addChildWithPassword(running.server, parent, family.id);
    await browser().login(loginOf(sibling, true));
    const kid = browser();
    await kid.login(loginOf(child, true));
    kid.cookies.delete(CHILD_SESSION_COOKIE);

    const response = await kid.loginRemembered(sibling.id);

    expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('remember_invalid');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await kid.me()).status).toBe(401);
    expect(await deviceRows(running.databaseUrl, sibling.id)).toHaveLength(1);
  });

  it('does not list the children another browser remembers', async () => {
    await browser().login(loginOf(child, true));
    const stranger = browser();
    stranger.cookies.set(DEVICE_COOKIE, Buffer.alloc(32, 9).toString('base64url'));

    const response = await stranger.get('/api/child-auth/remembered');

    expect(response.body).toEqual([]);
  });

  describe('a device token the api never issued, written into the browser beforehand', () => {
    it.each<[string, (kid: ChildBrowser) => Promise<RememberingLogin>]>([
      [
        'logging in with the account',
        async (kid) => {
          const victim = await addChildWithPassword(running.server, parent, family.id);
          return { childId: victim.id, response: await kid.login(loginOf(victim, true)) };
        },
      ],
      [
        'logging in with the password on a link',
        async (kid) => {
          const victim = await addChildWithPassword(running.server, parent, family.id);
          const { token } = await newLoginLink(running.server, parent, family.id, victim.id);
          const response = await kid.post(`${linkPath(token)}/login`, {
            password: victim.password,
            remember: true,
          });
          return { childId: victim.id, response };
        },
      ],
      [
        'setting the first password on a link',
        async (kid) => {
          const victim = await addChild(running.server, parent, family.id);
          const { token } = await newLoginLink(running.server, parent, family.id, victim.id);
          const response = await kid.post(`${linkPath(token)}/password`, {
            password: 'my secret',
            remember: true,
          });
          return { childId: victim.id, response };
        },
      ],
    ])(
      'does not become the device credential when %s remembers the child; the response sets another token',
      async (_case, logIn) => {
        const planted = Buffer.alloc(32, 5).toString('base64url');
        const kid = browser();
        kid.cookies.set(DEVICE_COOKIE, planted);

        const { childId, response } = await logIn(kid);

        expect(response.status).toBe(200);
        const issued = setCookiesOf(response)[DEVICE_COOKIE]?.value;
        expect(issued).toBeDefined();
        expect(issued).not.toBe(planted);
        expect(await devicesWithToken(planted)).toBe(0);
        const rows = await deviceRows(running.databaseUrl, childId);
        expect(rows.map((row) => row.token_hash)).toEqual([sha256(issued ?? '')]);

        const attacker = browser();
        attacker.cookies.set(DEVICE_COOKIE, planted);
        expect((await attacker.get('/api/child-auth/remembered')).body).toEqual([]);
        const remembered = await attacker.loginRemembered(childId);
        expect(remembered.status).toBe(401);
        expect(errorResponseSchema.parse(remembered.body).error.code).toBe('remember_invalid');
        expect((await attacker.me()).status).toBe(401);
      },
    );
  });

  describe('the Origin of requests that change data', () => {
    const badOrigins: Array<[string, string | undefined]> = [
      ['no Origin', undefined],
      ['another site', 'https://evil.example'],
    ];

    it.each(badOrigins)(
      'refuses every child login route with %s, changing nothing',
      async (_name, origin) => {
        const fresh = await addChild(running.server, parent, family.id);
        const { token } = await newLoginLink(running.server, parent, family.id, fresh.id);
        const routes: Array<[string, object | undefined]> = [
          ['/api/child-auth/login', loginOf(child, true)],
          [`/api/child-auth/remembered/${child.id}/login`, undefined],
          ['/api/child-auth/logout', undefined],
          [`${linkPath(token)}/password`, { password: 'my secret', remember: true }],
          [`${linkPath(token)}/login`, { password: 'my secret', remember: true }],
        ];

        for (const [path, body] of routes) {
          const call = request(running.server).post(path).send(body);
          const response = await (origin === undefined ? call : call.set('Origin', origin));

          expect(response.status).toBe(403);
          expect(errorResponseSchema.parse(response.body).error.code).toBe('bad_origin');
          expect(response.headers['set-cookie']).toBeUndefined();
        }
        expect(await stillUsable(token)).toBe(true);
      },
    );

    it('lets the reads through from any Origin', async () => {
      const response = await request(running.server)
        .get('/api/child-auth/remembered')
        .set('Origin', 'https://evil.example');

      expect(response.status).toBe(200);
    });

    it('lets a login from the site through', async () => {
      const response = await request(running.server)
        .post('/api/child-auth/login')
        .set('Origin', TEST_APP_ORIGIN)
        .send(loginOf(child));

      expect(response.status).toBe(200);
    });
  });
});
