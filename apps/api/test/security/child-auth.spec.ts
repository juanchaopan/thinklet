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
import { addChild, childrenPath, deviceRows, loginLinkRows } from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import {
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader } from '../support/login.js';

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

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for a
// child's login: a failed login does not say which item was wrong; a
// child's login opens no parent route and a parent's login no child route;
// one child's remembered browser does not log in another child; the routes
// that change data need this site's Origin, though they need no login.
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
        const [link] = await loginLinkRows(running.databaseUrl, fresh.id);
        expect(link?.used_at).toBeNull();
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
