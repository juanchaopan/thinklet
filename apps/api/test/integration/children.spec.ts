import { createHash } from 'node:crypto';
import {
  childDeviceListSchema,
  childListSchema,
  childLoginLinkSchema,
  childLoginLinkStatusResponseSchema,
  type Child,
  type ChildLoginLinkStatus,
  type FamilyDetail,
} from '@thinklet/contracts';
import {
  addChild,
  childPath,
  childRow,
  childrenPath,
  deviceRows,
  insertDevice,
  insertLoginLink,
  loginLinkRows,
  newAccount,
  setPasswordHash,
  testChildDataCipher,
  type ChildRow,
} from '../support/children.js';
import { TEST_APP_ORIGIN } from '../support/containers.js';
import {
  addMember,
  as,
  createFamily,
  outcomesOf,
  signInParent,
  useAppWithServices,
  type Parent,
} from '../support/families.js';

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const cipher = testChildDataCipher();

// Acceptance criteria covered: every parent of a family can add a child
// with the guardian's consent, see the children in the order they were
// added, change a nickname and an account, and delete a child with its
// login links and devices; an account is unique within the family; the
// nickname, the account and the device names are stored encrypted; a
// password reset clears the password, forgets the devices and ends the
// logins issued before it while unused login links keep working; a new
// login link revokes the older ones, and its state follows use, expiry and
// revocation; the remembered devices are listed latest first and can be
// revoked one by one or all at once.
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

  beforeAll(async () => {
    admin = await signInParent(running.server, { name: '林悦' });
    member = await signInParent(running.server, { name: '周子航' });
    family = await newFamily();
  });

  describe('adding and listing', () => {
    it('lists no children in a new family', async () => {
      expect(await listOf((await newFamily()).id)).toEqual([]);
    });

    it('adds a child with the trimmed nickname and lists it at once, in the order added', async () => {
      const { id: familyId } = await newFamily();

      const response = await asMember().post(childrenPath(familyId), {
        nickname: '  小米 ',
        account: ' xiaomi ',
        consent: true,
      });
      const second = await addTo(familyId, { nickname: '大米', account: 'dami' });

      expect(response.status).toBe(201);
      const first = response.body as Child;
      expect(first).toEqual({ id: expect.any(String), nickname: '小米', account: 'xiaomi' });
      expect(await listOf(familyId)).toEqual([first, second]);
    });

    it("records the adding parent's consent, its version and time, and no password", async () => {
      const before = Date.now();

      const child = await addChild(running.server, member, family.id);

      const row = await storedRow(child.id);
      expect(row).toMatchObject({
        family_id: family.id,
        password_hash: null,
        consent_parent_id: member.id,
        consent_version: '2026-11-22',
      });
      expect(row.consented_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.consented_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(row.sessions_valid_after).toEqual(row.consented_at);
    });

    it('stores the nickname and the account only as ciphertext, with a hex lookup value', async () => {
      const account = newAccount();

      const child = await addTo(family.id, { nickname: '小米粒', account });

      const row = await storedRow(child.id);
      expect(row.nickname).not.toContain('小米粒');
      expect(row.account).not.toContain(account);
      expect(row.nickname).toMatch(/^v1\./);
      expect(row.account).toMatch(/^v1\./);
      expect(cipher.decrypt(row.nickname)).toBe('小米粒');
      expect(cipher.decrypt(row.account)).toBe(account);
      expect(row.account_lookup).toMatch(HEX_SHA256);
      expect(row.account_lookup).toBe(cipher.lookup(family.id, account));
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
      expect((await storedRow(child.id)).account_lookup).toBe(
        cipher.lookup(family.id, child.account),
      );
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
    it('deletes the child with its login links and devices, then answers it as not found', async () => {
      const child = await addTo(family.id);
      await insertLoginLink(running.databaseUrl, { id: child.id, createdBy: admin.id });
      await rememberNow(child.id);

      const deleted = await asMember().delete(childPath(family.id, child.id));
      const again = await asMember().delete(childPath(family.id, child.id));

      expect(deleted.status).toBe(204);
      expect(outcomesOf([again])).toEqual([[404, 'child_not_found']]);
      expect(await childRow(running.databaseUrl, child.id)).toBeUndefined();
      expect(await loginLinkRows(running.databaseUrl, child.id)).toEqual([]);
      expect(await deviceRows(running.databaseUrl, child.id)).toEqual([]);
      expect((await listOf(family.id)).map(({ id }) => id)).not.toContain(child.id);
    });
  });

  describe('resetting the password', () => {
    it('clears the password, ends earlier logins and forgets the devices; unused links stay', async () => {
      const child = await addTo(family.id);
      await setPasswordHash(running.databaseUrl, child.id);
      await rememberNow(child.id);
      const link = await asAdmin().post(`${childPath(family.id, child.id)}/login-links`);
      const before = await storedRow(child.id);

      const response = await asMember().post(`${childPath(family.id, child.id)}/password-reset`);

      expect(response.status).toBe(204);
      const after = await storedRow(child.id);
      expect(before.password_hash).not.toBeNull();
      expect(after.password_hash).toBeNull();
      expect(after.sessions_valid_after.getTime()).toBeGreaterThan(
        before.sessions_valid_after.getTime(),
      );
      expect(await deviceRows(running.databaseUrl, child.id)).toEqual([]);
      const status = await asAdmin().get(
        `${childPath(family.id, child.id)}/login-links/${childLoginLinkSchema.parse(link.body).id}`,
      );
      expect(status.body).toMatchObject({ status: 'active' });
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
    const statusOf = async (linkId: string): Promise<ChildLoginLinkStatus> =>
      childLoginLinkStatusResponseSchema.parse(
        (await asAdmin().get(`${linksPath()}/${linkId}`).expect(200)).body,
      ).status;
    const linkAt = (times: Parameters<typeof insertLoginLink>[2]) =>
      insertLoginLink(running.databaseUrl, { id: child.id, createdBy: admin.id }, times);

    beforeEach(async () => {
      child = await addTo(family.id);
    });

    it('makes a link to the QR login page for 10 minutes, keeping only the hash of its token', async () => {
      const before = Date.now();

      const response = await asMember().post(linksPath());

      expect(response.status).toBe(201);
      const link = childLoginLinkSchema.parse(response.body);
      const prefix = `${TEST_APP_ORIGIN}/child/qr/`;
      expect(link.url.startsWith(prefix)).toBe(true);
      const token = link.url.slice(prefix.length);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const expiresAt = Date.parse(link.expiresAt);
      expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
      const rows = await loginLinkRows(running.databaseUrl, child.id);
      expect(rows).toEqual([
        expect.objectContaining({
          id: link.id,
          token_hash: createHash('sha256').update(token).digest('hex'),
          created_by: member.id,
          used_at: null,
          revoked_at: null,
        }),
      ]);
      expect(rows[0]?.expires_at.toISOString()).toBe(link.expiresAt);
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(await statusOf(link.id)).toBe('active');
    });

    it('revokes the active links when a new one is made, leaving used and expired ones', async () => {
      const used = await linkAt({ usedAt: "now() - interval '30 seconds'" });
      const expired = await linkAt({ expiresAt: "now() - interval '1 second'" });
      const first = childLoginLinkSchema.parse((await asAdmin().post(linksPath())).body);

      const second = childLoginLinkSchema.parse((await asMember().post(linksPath())).body);

      expect([
        await statusOf(used),
        await statusOf(expired),
        await statusOf(first.id),
        await statusOf(second.id),
      ]).toEqual(['used', 'expired', 'revoked', 'active']);
      const rows = await loginLinkRows(running.databaseUrl, child.id);
      expect(rows.filter(({ revoked_at }) => revoked_at !== null).map(({ id }) => id)).toEqual([
        first.id,
      ]);
    });

    it('reads a used link as used and a revoked one as revoked, even once expired', async () => {
      const usedThenExpired = await linkAt({
        expiresAt: "now() - interval '1 minute'",
        usedAt: "now() - interval '5 minutes'",
      });
      const revokedThenExpired = await linkAt({
        expiresAt: "now() - interval '1 minute'",
        revokedAt: "now() - interval '5 minutes'",
      });

      expect([await statusOf(usedThenExpired), await statusOf(revokedThenExpired)]).toEqual([
        'used',
        'revoked',
      ]);
    });

    it("answers another child's link, an unknown link and a malformed id with not_found", async () => {
      const sibling = await addTo(family.id);
      const theirs = await insertLoginLink(running.databaseUrl, {
        id: sibling.id,
        createdBy: admin.id,
      });

      const responses = [
        await asAdmin().get(`${linksPath()}/${theirs}`),
        await asAdmin().get(`${linksPath()}/${crypto.randomUUID()}`),
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

    it('lists the devices latest login first, with their names stored only as ciphertext', async () => {
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
      for (const row of await deviceRows(running.databaseUrl, child.id)) {
        expect(row.name).toMatch(/^v1\./);
        expect(row.name).not.toMatch(/iPad|Safari|Windows|Edge/);
      }
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
