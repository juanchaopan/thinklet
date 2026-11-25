import {
  childDeviceListSchema,
  childListSchema,
  childLoginLinkSchema,
  childLoginLinkStatusResponseSchema,
  type Child,
  type ChildLoginLinkStatusResponse,
  type FamilyDetail,
} from '@thinklet/contracts';
import { ChildBrowser, linkPath } from '../support/child-login.js';
import {
  addChild,
  childPath,
  childRow,
  childrenPath,
  decryptedChild,
  decryptedDeviceName,
  deviceRows,
  insertDevice,
  newAccount,
  setPasswordHash,
  testChildDataCipher,
  type ChildRow,
} from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import { query } from '../support/database.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';
import { expireLoginLink, redisContents, sha256, storedLoginLink } from '../support/login-links.js';

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const cipher = testChildDataCipher();

/** A key Redis does not hold, as storedLoginLink reads it. */
const NO_KEY = { value: null, expiresAt: -2 };

/** A login link a parent made through the api, with its token and its child. */
interface MadeLink {
  id: string;
  url: string;
  expiresAt: string;
  token: string;
  childId: string;
}

// Acceptance criteria covered: every parent of a family can add a child
// with the guardian's consent, recorded with its version in the audit
// events, without a password, see the children in the order they were
// added with whether each has set a password, change a nickname and an
// account, and delete a child with its devices and its login link; an
// account is unique within the family; the nickname, the account and the
// device names are stored encrypted, each bound to its row and column, so
// a ciphertext moved elsewhere is an error rather than shown; a password
// reset clears the password, opens the time to set a new one, forgets the
// devices and ends the logins issued before it while an unused login link
// keeps working; the login links live in Redis for 10 minutes under the
// hash of their token, a new one revokes the older one, and its state
// follows use, expiry and revocation (#14, 24); the remembered devices are
// listed latest first and can be revoked one by one or all at once. The
// time to set a password with the account is in child-first-password.spec.ts.
describe('children', () => {
  const running = useAppWithServices();
  let admin: Parent;
  let member: Parent;
  let family: FamilyDetail;

  const asAdmin = () => as(running.server, admin);
  const asMember = () => as(running.server, member);
  const addTo = (familyId: string, child?: { nickname?: string; account?: string }) =>
    addChild(running.server, admin, familyId, child);
  const listOf = async (familyId: string) =>
    childListSchema.parse((await asAdmin().get(childrenPath(familyId)).expect(200)).body);
  const rememberNow = (childId: string) =>
    insertDevice(running.databaseUrl, childId, {
      name: 'iPad · Safari',
      rememberedAt: new Date(),
      lastUsedAt: new Date(),
    });

  /** The child's row; fails when there is none. */
  async function storedRow(childId: string): Promise<ChildRow> {
    const row = await childRow(running.databaseUrl, childId);
    if (row === undefined) {
      throw new Error(`No child ${childId}`);
    }
    return row;
  }

  /** A new family of the admin, with the member in it. */
  async function newFamily(): Promise<FamilyDetail> {
    const created = await createFamily(running.server, admin);
    await addMember(running.databaseUrl, created.id, member.id);
    return created;
  }

  /** Makes a login link of the child as the parent. */
  async function makeLink(child: Child, parent: Parent = admin): Promise<MadeLink> {
    const response = await as(running.server, parent).post(
      `${childPath(family.id, child.id)}/login-links`,
    );
    expect(response.status).toBe(201);
    const link = childLoginLinkSchema.parse(response.body);
    const token = link.url.slice(`${TEST_APP_ORIGIN}/child/qr/`.length);
    return { ...link, token, childId: child.id };
  }

  /** Uses the link to set its child's first password, as the child does on scanning it. */
  async function usePassword(link: MadeLink): Promise<void> {
    const response = await new ChildBrowser(running.server).post(
      `${linkPath(link.token)}/password`,
      { password: 'my secret', remember: false },
    );
    expect(response.status).toBe(200);
  }

  beforeAll(async () => {
    admin = await signInParent(running.server, { name: '林悦' });
    member = await signInParent(running.server, { name: '周子航' });
    family = await newFamily();
  });

  describe('adding and listing', () => {
    it('lists no children in a new family', async () => {
      expect(await listOf((await newFamily()).id)).toEqual([]);
    });

    it('adds a child with the trimmed nickname and no password, and lists it at once, in the order added', async () => {
      const { id: familyId } = await newFamily();

      const response = await asMember().post(childrenPath(familyId), {
        nickname: '  小米 ',
        account: ' xiaomi ',
        consent: true,
      });
      const second = await addTo(familyId, { nickname: '大米', account: 'dami' });

      expect(response.status).toBe(201);
      const first = response.body as Child;
      expect(first).toEqual({
        id: expect.any(String) as unknown,
        nickname: '小米',
        account: 'xiaomi',
        passwordSet: false,
        passwordSetupUntil: expect.any(String) as unknown,
      });
      expect(await listOf(familyId)).toEqual([first, second]);
    });

    it("records the adding parent's consent and its version in the audit events, and no password", async () => {
      const before = Date.now();

      const child = await addChild(running.server, member, family.id);

      const row = await storedRow(child.id);
      expect(row).toMatchObject({ family_id: family.id, password_hash: null });
      expect(row.sessions_valid_after.getTime()).toBeGreaterThanOrEqual(before - 1000);
      const [consent] = await query<{
        actor_id: string;
        family_id: string;
        details: unknown;
        occurred_at: Date;
      }>(
        running.databaseUrl,
        `select actor_id, family_id, details, occurred_at from audit_events
         where action = 'child.created' and target_id = $1`,
        [child.id],
      );
      expect(consent).toMatchObject({
        actor_id: member.id,
        family_id: family.id,
        details: { consentVersion: '2026-11-22' },
      });
      expect(consent?.occurred_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(consent?.occurred_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('stores the nickname and the account only as ciphertext bound to the row, with a hex lookup value', async () => {
      const account = newAccount();

      const child = await addTo(family.id, { nickname: '小米粒', account });

      const row = await storedRow(child.id);
      expect(row.nickname).not.toContain('小米粒');
      expect(row.account).not.toContain(account);
      expect(row.nickname).toMatch(/^v1\./);
      expect(row.account).toMatch(/^v1\./);
      expect(decryptedChild(row)).toEqual({ nickname: '小米粒', account });
      expect(row.account_lookup).toMatch(HEX_SHA256);
      expect(row.account_lookup).toBe(cipher.lookup(family.id, account));
    });

    it('answers 500 internal rather than show a ciphertext moved from another child or column', async () => {
      const swapped = await newFamily();
      const crossed = await newFamily();
      const xiaomi = await addTo(swapped.id, { nickname: '小米' });
      const doudou = await addTo(swapped.id, { nickname: '豆豆' });
      const ale = await addTo(crossed.id, { nickname: '阿乐' });
      const copyIntoNickname = (column: 'nickname' | 'account', from: string, to: string) =>
        query(
          running.databaseUrl,
          `update children set nickname = (select ${column} from children where id = $1) where id = $2`,
          [from, to],
        );

      await copyIntoNickname('nickname', doudou.id, xiaomi.id);
      await copyIntoNickname('account', ale.id, ale.id);
      const responses = [
        await asAdmin().get(childrenPath(swapped.id)),
        await asAdmin().get(childrenPath(crossed.id)),
      ];

      expect(outcomesOf(responses)).toEqual([
        [500, 'internal'],
        [500, 'internal'],
      ]);
      expect(JSON.stringify(responses.map(({ body }): unknown => body))).not.toMatch(
        /小米|豆豆|阿乐/,
      );
    });

    it('refuses an account another child of the family has, and lets another family use it', async () => {
      const account = newAccount();
      await addTo(family.id, { account });
      const other = await newFamily();

      const response = await asAdmin().post(childrenPath(family.id), {
        nickname: '小米',
        account,
        consent: true,
      });

      expect(outcomesOf([response])).toEqual([[409, 'account_taken']]);
      await expect(addTo(other.id, { account })).resolves.toMatchObject({ account });
    });

    it('needs the consent, a nickname and an account of lower-case letters and digits', async () => {
      const response = await asAdmin().post(childrenPath(family.id), {
        nickname: '   ',
        account: 'XiaoMi',
        consent: false,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'invalid_request',
          fields: [
            { path: 'nickname', code: 'required' },
            { path: 'account', code: 'invalid' },
            { path: 'consent', code: 'required' },
          ],
        },
      });
    });
  });

  describe('changing', () => {
    it('changes the nickname and the account apart or together, and lists the change at once', async () => {
      const child = await addTo(family.id);
      const account = newAccount();

      const renamed = await asMember().patch(childPath(family.id, child.id), { nickname: '米米' });
      const moved = await asAdmin().patch(childPath(family.id, child.id), { account });
      const both = await asAdmin().patch(childPath(family.id, child.id), {
        nickname: '小米',
        account: child.account,
      });

      expect([renamed.status, moved.status, both.status]).toEqual([200, 200, 200]);
      expect(renamed.body).toEqual({ ...child, nickname: '米米' });
      expect(moved.body).toEqual({ ...child, nickname: '米米', account });
      expect(both.body).toEqual(child);
      expect(await listOf(family.id)).toContainEqual(child);
      const row = await storedRow(child.id);
      expect(decryptedChild(row)).toEqual({ nickname: child.nickname, account: child.account });
      expect(row.account_lookup).toBe(cipher.lookup(family.id, child.account));
    });

    it('keeps the child as it is on a change without fields, and allows its own account', async () => {
      const child = await addTo(family.id);

      const responses = [
        await asAdmin().patch(childPath(family.id, child.id), {}),
        await asAdmin().patch(childPath(family.id, child.id), { account: child.account }),
      ];

      expect(responses.map(({ status, body }): unknown => [status, body])).toEqual([
        [200, child],
        [200, child],
      ]);
    });

    it('refuses an account another child of the family has and keeps the old one', async () => {
      const taken = await addTo(family.id);
      const child = await addTo(family.id);

      const response = await asAdmin().patch(childPath(family.id, child.id), {
        nickname: '新名字',
        account: taken.account,
      });

      expect(outcomesOf([response])).toEqual([[409, 'account_taken']]);
      expect(await listOf(family.id)).toContainEqual(child);
    });

    it('answers a child that does not exist with child_not_found', async () => {
      const response = await asAdmin().patch(childPath(family.id, crypto.randomUUID()), {
        nickname: '米米',
      });

      expect(outcomesOf([response])).toEqual([[404, 'child_not_found']]);
    });
  });

  describe('deleting', () => {
    it('deletes the child with its devices and every key of its login link, then answers it as not found', async () => {
      const child = await addTo(family.id);
      const link = await makeLink(child);
      await rememberNow(child.id);

      const deleted = await asMember().delete(childPath(family.id, child.id));
      const again = await asMember().delete(childPath(family.id, child.id));

      expect(deleted.status).toBe(204);
      expect(outcomesOf([again])).toEqual([[404, 'child_not_found']]);
      expect(await childRow(running.databaseUrl, child.id)).toBeUndefined();
      expect(await storedLoginLink(running.redisUrl, link)).toEqual({
        token: NO_KEY,
        state: NO_KEY,
        current: NO_KEY,
      });
      expect(await deviceRows(running.databaseUrl, child.id)).toEqual([]);
      expect((await listOf(family.id)).map(({ id }) => id)).not.toContain(child.id);
    });

    it("leaves another child's login link as it was", async () => {
      const child = await addTo(family.id);
      const sibling = await addTo(family.id);
      await makeLink(child);
      const siblings = await makeLink(sibling);
      const before = await storedLoginLink(running.redisUrl, siblings);

      await asAdmin().delete(childPath(family.id, child.id)).expect(204);

      expect(await storedLoginLink(running.redisUrl, siblings)).toEqual(before);
      expect(before.token.value).not.toBeNull();
    });
  });

  describe('resetting the password', () => {
    it('clears the password, opens the time to set one, ends earlier logins and forgets the devices; an unused link stays', async () => {
      const child = await addTo(family.id);
      await setPasswordHash(running.databaseUrl, child.id);
      await rememberNow(child.id);
      const link = await makeLink(child);
      const before = await storedRow(child.id);

      const response = await asMember().post(`${childPath(family.id, child.id)}/password-reset`);

      expect(response.status).toBe(204);
      const after = await storedRow(child.id);
      expect(before.password_hash).not.toBeNull();
      expect(before.password_setup_until).toBeNull();
      expect(after.password_hash).toBeNull();
      expect(after.password_setup_until?.getTime()).toBeGreaterThan(
        after.sessions_valid_after.getTime(),
      );
      expect(after.sessions_valid_after.getTime()).toBeGreaterThan(
        before.sessions_valid_after.getTime(),
      );
      expect(await deviceRows(running.databaseUrl, child.id)).toEqual([]);
      const status = await asAdmin().get(
        `${childPath(family.id, child.id)}/login-links/${link.id}`,
      );
      expect(status.body).toMatchObject({ status: 'active' });
      expect((await new ChildBrowser(running.server).get(linkPath(link.token))).body).toEqual({
        childId: child.id,
        nickname: child.nickname,
        needsPassword: true,
      });
    });

    it('answers a child that does not exist with child_not_found', async () => {
      const response = await asAdmin().post(
        `${childPath(family.id, crypto.randomUUID())}/password-reset`,
      );

      expect(outcomesOf([response])).toEqual([[404, 'child_not_found']]);
    });
  });

  describe('login links', () => {
    let child: Child;
    const linksPath = () => `${childPath(family.id, child.id)}/login-links`;
    const statusOf = async (linkId: string): Promise<ChildLoginLinkStatusResponse> =>
      childLoginLinkStatusResponseSchema.parse(
        (await asAdmin().get(`${linksPath()}/${linkId}`).expect(200)).body,
      );

    beforeEach(async () => {
      child = await addTo(family.id);
    });

    it('makes a link to the QR login page that Redis holds for 10 minutes, under the hash of its token', async () => {
      const before = Date.now();

      const link = await makeLink(child, member);

      expect(Buffer.from(link.token, 'base64url')).toHaveLength(32);
      const expiresAt = Date.parse(link.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
      const stored = await storedLoginLink(running.redisUrl, link);
      expect(JSON.parse(stored.token.value ?? 'null')).toEqual({
        linkId: link.id,
        childId: child.id,
      });
      expect(JSON.parse(stored.state.value ?? 'null')).toEqual({
        childId: child.id,
        status: 'active',
        expiresAt: link.expiresAt,
      });
      expect(JSON.parse(stored.current.value ?? 'null')).toEqual({
        linkId: link.id,
        tokenHash: sha256(link.token),
      });
      expect([stored.token, stored.state, stored.current].map((key) => key.expiresAt)).toEqual([
        expiresAt,
        expiresAt,
        expiresAt,
      ]);
      expect(JSON.stringify(await redisContents(running.redisUrl))).not.toContain(link.token);
      expect(await statusOf(link.id)).toEqual({ status: 'active', expiresAt: link.expiresAt });
    });

    it('revokes the active link when a new one is made, deleting its token, and leaves a used one used', async () => {
      const used = await makeLink(child);
      await usePassword(used);
      const first = await makeLink(child);

      const second = await makeLink(child);

      expect([
        (await statusOf(used.id)).status,
        (await statusOf(first.id)).status,
        (await statusOf(second.id)).status,
      ]).toEqual(['used', 'revoked', 'active']);
      expect((await storedLoginLink(running.redisUrl, first)).token).toEqual(NO_KEY);
      expect((await storedLoginLink(running.redisUrl, used)).token).toEqual(NO_KEY);
      const current = (await storedLoginLink(running.redisUrl, second)).current.value;
      expect(JSON.parse(current ?? 'null')).toEqual({
        linkId: second.id,
        tokenHash: sha256(second.token),
      });
    });

    it('keeps the state of a used or revoked link until the link expires, with its expiry time', async () => {
      const used = await makeLink(child);
      await usePassword(used);
      const revoked = await makeLink(child);
      await makeLink(child);

      const states = [
        (await storedLoginLink(running.redisUrl, used)).state,
        (await storedLoginLink(running.redisUrl, revoked)).state,
      ];

      expect(states.map(({ expiresAt }) => expiresAt)).toEqual([
        Date.parse(used.expiresAt),
        Date.parse(revoked.expiresAt),
      ]);
      expect(await statusOf(used.id)).toEqual({ status: 'used', expiresAt: used.expiresAt });
      expect(await statusOf(revoked.id)).toEqual({
        status: 'revoked',
        expiresAt: revoked.expiresAt,
      });
    });

    it.each<[string, (link: MadeLink) => Promise<void>]>([
      ['an active link', () => Promise.resolve()],
      ['a used link', (link) => usePassword(link)],
    ])('reads %s as expired once its time is up', async (_case, before) => {
      const link = await makeLink(child);
      await before(link);

      await expireLoginLink(running.redisUrl, link);
      const started = Date.now();
      const { status, expiresAt } = await statusOf(link.id);

      expect(status).toBe('expired');
      expect(Date.parse(expiresAt)).toBeGreaterThanOrEqual(started - 1000);
      expect(Date.parse(expiresAt)).toBeLessThanOrEqual(Date.now());
    });

    it('reads an id that names no link as expired, since a link that expired leaves nothing either', async () => {
      expect((await statusOf(crypto.randomUUID())).status).toBe('expired');
    });

    it("answers another child's link and a malformed id with not_found", async () => {
      const sibling = await addTo(family.id);
      const theirs = await makeLink(sibling);

      const responses = [
        await asAdmin().get(`${linksPath()}/${theirs.id}`),
        await asAdmin().get(`${linksPath()}/not-an-id`),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'not_found']));
    });

    it('answers a child that does not exist with child_not_found', async () => {
      const path = `${childPath(family.id, crypto.randomUUID())}/login-links`;

      const responses = [
        await asAdmin().post(path),
        await asAdmin().get(`${path}/${crypto.randomUUID()}`),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'child_not_found']));
    });
  });

  describe('devices', () => {
    let child: Child;
    const devicesPath = () => `${childPath(family.id, child.id)}/devices`;
    const listed = async () =>
      childDeviceListSchema.parse((await asMember().get(devicesPath()).expect(200)).body);
    const remember = (name: string, lastUsedAt: string) =>
      insertDevice(running.databaseUrl, child.id, {
        name,
        rememberedAt: new Date('2026-11-18T08:30:00Z'),
        lastUsedAt: new Date(lastUsedAt),
      });

    beforeEach(async () => {
      child = await addTo(family.id);
    });

    it('lists the devices latest login first, with their names stored only as ciphertext bound to the row', async () => {
      const older = await remember('Windows 电脑 · Edge', '2026-11-20T10:00:00Z');
      const newer = await remember('iPad · Safari', '2026-11-22T01:12:00Z');

      expect(await listed()).toEqual([
        {
          id: newer,
          name: 'iPad · Safari',
          rememberedAt: '2026-11-18T08:30:00.000Z',
          lastUsedAt: '2026-11-22T01:12:00.000Z',
        },
        {
          id: older,
          name: 'Windows 电脑 · Edge',
          rememberedAt: '2026-11-18T08:30:00.000Z',
          lastUsedAt: '2026-11-20T10:00:00.000Z',
        },
      ]);
      const rows = await deviceRows(running.databaseUrl, child.id);
      for (const row of rows) {
        expect(row.name).toMatch(/^v1\./);
        expect(row.name).not.toMatch(/iPad|Safari|Windows|Edge/);
      }
      expect(rows.map(decryptedDeviceName)).toEqual(['iPad · Safari', 'Windows 电脑 · Edge']);
    });

    it('revokes one device, and answers 204 again once it is gone', async () => {
      const kept = await remember('iPad · Safari', '2026-11-22T01:12:00Z');
      const revoked = await remember('Android 手机 · Chrome', '2026-11-21T01:12:00Z');

      const responses = [
        await asAdmin().delete(`${devicesPath()}/${revoked}`),
        await asAdmin().delete(`${devicesPath()}/${revoked}`),
        await asAdmin().delete(`${devicesPath()}/not-an-id`),
      ];

      expect(responses.map(({ status }) => status)).toEqual([204, 204, 204]);
      expect((await listed()).map(({ id }) => id)).toEqual([kept]);
    });

    it('revokes every device of the child and leaves those of the others', async () => {
      const sibling = await addTo(family.id);
      const siblings = await rememberNow(sibling.id);
      await remember('iPad · Safari', '2026-11-22T01:12:00Z');
      await remember('Android 手机 · Chrome', '2026-11-21T01:12:00Z');

      const response = await asAdmin().delete(devicesPath());

      expect(response.status).toBe(204);
      expect(await listed()).toEqual([]);
      expect((await deviceRows(running.databaseUrl, sibling.id)).map(({ id }) => id)).toEqual([
        siblings,
      ]);
    });

    it('answers a child that does not exist with child_not_found', async () => {
      const path = `${childPath(family.id, crypto.randomUUID())}/devices`;

      const responses = [
        await asAdmin().get(path),
        await asAdmin().delete(`${path}/${crypto.randomUUID()}`),
        await asAdmin().delete(path),
      ];

      expect(outcomesOf(responses)).toEqual(responses.map(() => [404, 'child_not_found']));
    });
  });
});
