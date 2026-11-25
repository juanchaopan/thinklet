import { errorResponseSchema, type FamilyDetail } from '@thinklet/contracts';
import request from 'supertest';
import { rowsAddedBy } from '../support/audit.js';
import {
  CHILD_ME_PATH,
  CHILD_SESSION_COOKIE,
  signInWithNewPassword,
} from '../support/child-login.js';
import { addChild, childRow, decryptedChild } from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import {
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { cookieHeader } from '../support/login.js';

/** A change of the nickname to send. */
const RENAME = { nickname: '米米' };

/** Headers of a request: names and values. */
type Headers = Record<string, string>;

// Security test cases of .docs/architecture.md ("指标和要求", 安全) for the
// child's own settings (#14, 26): only a signed-in child changes a
// nickname through them, and only its own: a parent's login, in either
// cookie, changes nothing, a child cannot name another child, of its
// family or another, and a request from another site is refused.
describe("security of the child's own settings", () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  /** The nickname the database holds for the child, decrypted. */
  const storedNickname = async (childId: string) => {
    const row = await childRow(running.databaseUrl, childId);
    if (row === undefined) {
      throw new Error(`No child ${childId}`);
    }
    return decryptedChild(row).nickname;
  };

  /** A new child of the family named 小米, signed in on a browser of its own. */
  const signedInChild = async () => {
    const child = await addChild(running.server, parent, family.id, { nickname: '小米' });
    const { browser } = await signInWithNewPassword(running.server, parent, family.id, child.id);
    return { id: child.id, browser };
  };

  /** A change of the nickname sent with the cookies and the headers given, nothing else. */
  const renameWith = (cookies: Record<string, string>, headers: Headers) =>
    request(running.server)
      .patch(CHILD_ME_PATH)
      .set({ ...headers, Cookie: cookieHeader(cookies) })
      .send(RENAME);

  beforeAll(async () => {
    parent = await signInParent(running.server);
    family = await createFamily(running.server, parent);
  });

  it("changes no nickname with a parent's login, in the parent's cookie or the child's", async () => {
    const child = await addChild(running.server, parent, family.id, { nickname: '小米' });
    const parentLogin = parent.cookies['thinklet_session'] ?? '';
    const logins = [parent.cookies, { [CHILD_SESSION_COOKIE]: parentLogin }];

    const { result: responses, added } = await rowsAddedBy(running.databaseUrl, () =>
      Promise.all(logins.map((cookies) => renameWith(cookies, { Origin: TEST_APP_ORIGIN }))),
    );

    for (const response of responses) {
      expect([response.status, errorResponseSchema.parse(response.body).error.code]).toEqual([
        401,
        'unauthenticated',
      ]);
    }
    expect(added).toEqual([]);
    expect(await storedNickname(child.id)).toBe('小米');
  });

  describe('another child', () => {
    it.each(['id', 'childId'])(
      'cannot be named with %s in the body, of the family or another',
      async (key) => {
        const kid = await signedInChild();
        const sibling = await addChild(running.server, parent, family.id, { nickname: '豆豆' });
        const otherParent = await signInParent(running.server);
        const otherFamily = await createFamily(running.server, otherParent);
        const stranger = await addChild(running.server, otherParent, otherFamily.id, {
          nickname: '阿乐',
        });

        const responses = [
          await kid.browser.rename({ ...RENAME, [key]: sibling.id }),
          await kid.browser.rename({ ...RENAME, [key]: stranger.id }),
        ];

        expect(responses.map(({ status }) => status)).toEqual([400, 400]);
        expect(await storedNickname(kid.id)).toBe('小米');
        expect(await storedNickname(sibling.id)).toBe('豆豆');
        expect(await storedNickname(stranger.id)).toBe('阿乐');
      },
    );

    it('keeps its nickname when a child changes its own: only that child’s row changes', async () => {
      const kid = await signedInChild();
      const sibling = await addChild(running.server, parent, family.id, { nickname: '豆豆' });

      expect((await kid.browser.rename(RENAME)).status).toBe(200);

      expect(await storedNickname(kid.id)).toBe('米米');
      expect(await storedNickname(sibling.id)).toBe('豆豆');
    });
  });

  it('refuses a change sent without an Origin or from another site, changing nothing', async () => {
    const kid = await signedInChild();
    const login = { [CHILD_SESSION_COOKIE]: kid.browser.cookies.get(CHILD_SESSION_COOKIE) ?? '' };
    const badOrigins: Headers[] = [{}, { Origin: 'https://evil.example' }];

    const refusals = await Promise.all(
      badOrigins.map(async (headers) => {
        const response = await renameWith(login, headers);
        return [response.status, errorResponseSchema.parse(response.body).error.code];
      }),
    );

    expect(refusals).toEqual([
      [403, 'bad_origin'],
      [403, 'bad_origin'],
    ]);
    expect(await storedNickname(kid.id)).toBe('小米');
  });
});
