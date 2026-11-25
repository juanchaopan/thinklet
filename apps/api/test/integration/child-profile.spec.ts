import { childListSchema, errorResponseSchema, type FamilyDetail } from '@thinklet/contracts';
import { auditRows, rowsAddedBy } from '../support/audit.js';
import { ChildBrowser, signInWithNewPassword } from '../support/child-login.js';
import {
  addChild,
  childPath,
  childRow,
  childrenPath,
  decryptedChild,
  newAccount,
} from '../support/children.js';
import {
  as,
  createFamily,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

/** A combining accent: two bytes of UTF-8 that add no character. */
const ACUTE = String.fromCodePoint(0x301);

/** A signed-in child of the tests' family, on its own browser. */
interface SignedInChild {
  id: string;
  account: string;
  browser: ChildBrowser;
}

// Acceptance criterion covered (#14, 26): a signed-in child sees its own
// nickname, account and family name, and changes its own nickname by the
// rule the parents change it by (1–10 characters after trimming, at most
// 160 bytes); the change is stored encrypted for the child's row, the
// parents see it at once, and it is recorded as the child's own change in
// the same transaction. A child changes nothing else, not even its account.
describe("the child's own settings", () => {
  const running = useAppWithServices();
  let parent: Parent;
  let family: FamilyDetail;

  /** A new child of the family, signed in on a browser of its own. */
  const signedInChild = async (): Promise<SignedInChild> => {
    const account = newAccount();
    const child = await addChild(running.server, parent, family.id, { nickname: '小米', account });
    const { browser } = await signInWithNewPassword(running.server, parent, family.id, child.id);
    return { id: child.id, account, browser };
  };

  /** The nickname the parents see of the child. */
  const nicknameParentsSee = async (childId: string) => {
    const response = await as(running.server, parent).get(childrenPath(family.id)).expect(200);
    return childListSchema.parse(response.body).find(({ id }) => id === childId)?.nickname;
  };

  beforeAll(async () => {
    parent = await signInParent(running.server, { name: '林悦' });
    family = await createFamily(running.server, parent, {
      name: '林悦的家',
      timezone: 'Asia/Shanghai',
    });
  });

  describe('GET /api/child/me', () => {
    it("answers the child's nickname and account and the family's name, never stored", async () => {
      const kid = await signedInChild();

      const response = await kid.browser.me();

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id: kid.id,
        nickname: '小米',
        account: kid.account,
        familyName: '林悦的家',
      });
    });

    it('answers the family by the name it has now', async () => {
      const otherParent = await signInParent(running.server);
      const other = await createFamily(running.server, otherParent, {
        name: '外婆家',
        timezone: 'Asia/Shanghai',
      });
      const child = await addChild(running.server, otherParent, other.id);
      const { browser } = await signInWithNewPassword(
        running.server,
        otherParent,
        other.id,
        child.id,
      );

      await as(running.server, otherParent)
        .patch(`/api/families/${other.id}`, { name: '外婆的家' })
        .expect(200);

      expect((await browser.me()).body).toMatchObject({ familyName: '外婆的家' });
    });
  });

  describe('PATCH /api/child/me', () => {
    it('changes the nickname, trimmed, answers the child as GET does, and the parents see it at once', async () => {
      const kid = await signedInChild();

      const response = await kid.browser.rename({ nickname: '  米米  ' });

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const expected = {
        id: kid.id,
        nickname: '米米',
        account: kid.account,
        familyName: '林悦的家',
      };
      expect(response.body).toEqual(expected);
      expect((await kid.browser.me()).body).toEqual(expected);
      expect(await nicknameParentsSee(kid.id)).toBe('米米');
    });

    it("stores the nickname encrypted for the child's row and column, never as typed", async () => {
      const kid = await signedInChild();

      expect((await kid.browser.rename({ nickname: '米粒儿' })).status).toBe(200);

      const row = await childRow(running.databaseUrl, kid.id);
      if (row === undefined) {
        throw new Error('The child is gone');
      }
      expect(row.nickname).not.toContain('米粒儿');
      expect(decryptedChild(row)).toEqual({ nickname: '米粒儿', account: kid.account });
    });

    it('takes 10 characters of any kind, an emoji counting once', async () => {
      const kid = await signedInChild();
      const nickname = `米🦊${'粒'.repeat(8)}`;

      const response = await kid.browser.rename({ nickname });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ nickname });
    });

    it.each<[string, object, string]>([
      ['a missing nickname', {}, 'required'],
      ['an empty nickname', { nickname: '' }, 'required'],
      ['a nickname of spaces', { nickname: '   ' }, 'required'],
      ['11 characters', { nickname: '米'.repeat(11) }, 'too_long'],
      ['161 bytes in one character', { nickname: `a${ACUTE.repeat(80)}` }, 'too_long'],
      ['a nickname that is not text', { nickname: 7 }, 'invalid'],
    ])(
      'refuses %s with 400, keeping the nickname and recording nothing',
      async (_case, body, code) => {
        const kid = await signedInChild();

        const { result: response, added } = await rowsAddedBy(running.databaseUrl, () =>
          kid.browser.rename(body),
        );

        expect(response.status).toBe(400);
        const { error } = errorResponseSchema.parse(response.body);
        expect(error.code).toBe('invalid_request');
        expect(error.fields).toEqual([{ path: 'nickname', code }]);
        expect(added).toEqual([]);
        expect(await nicknameParentsSee(kid.id)).toBe('小米');
      },
    );

    it('refuses an account, or any field but the nickname, and changes nothing', async () => {
      const kid = await signedInChild();

      const response = await kid.browser.rename({ nickname: '米米', account: newAccount() });

      expect(response.status).toBe(400);
      expect((await kid.browser.me()).body).toMatchObject({
        nickname: '小米',
        account: kid.account,
      });
    });

    it('records the change as the child’s own, with the field changed and not what it became', async () => {
      const kid = await signedInChild();

      const { added } = await rowsAddedBy(running.databaseUrl, () =>
        kid.browser.rename({ nickname: '米米' }),
      );

      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        actor_kind: 'child',
        actor_id: kid.id,
        actor_issuer: null,
        actor_subject: null,
        action: 'child.updated',
        target_kind: 'child',
        target_id: kid.id,
        family_id: family.id,
        details: { fields: ['nickname'] },
      });
      expect(JSON.stringify(added)).not.toContain('米米');
    });

    it('lets the last saved win when the parent and the child change the nickname', async () => {
      const kid = await signedInChild();

      await as(running.server, parent)
        .patch(childPath(family.id, kid.id), { nickname: '小米粒' })
        .expect(200);
      expect((await kid.browser.rename({ nickname: '米米' })).status).toBe(200);

      expect(await nicknameParentsSee(kid.id)).toBe('米米');
    });

    it('needs the child signed in, and answers a deleted child as no login', async () => {
      const kid = await signedInChild();
      const before = (await auditRows(running.databaseUrl)).length;

      const nobody = await new ChildBrowser(running.server).rename({ nickname: '米米' });
      await as(running.server, parent).delete(childPath(family.id, kid.id)).expect(204);
      const deleted = await kid.browser.rename({ nickname: '米米' });

      for (const response of [nobody, deleted]) {
        expect(response.status).toBe(401);
        expect(errorResponseSchema.parse(response.body).error.code).toBe('unauthenticated');
      }
      expect(await auditRows(running.databaseUrl)).toHaveLength(before + 1);
    });
  });
});
