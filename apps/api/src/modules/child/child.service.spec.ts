import type { Executor } from '../../infrastructure/database/database.module.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ChildSession } from '../auth/child-session.service.js';
import type { ChildLoginRepository, ChildProfile } from './child-login.repository.js';
import { ChildService, issuedSinceLastReset } from './child.service.js';
import type { ChildrenRepository, ChildStore } from './children.repository.js';

const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const FAMILY_ID = '5d1e6f70-8192-4a3b-8c4d-5e6f708192a3';
/** What a password reset at 09:00:05.700 by the database's clock stores: the next whole second. */
const RESET_VALID_AFTER = new Date('2026-11-22T09:00:06.000Z');
/** The database's clock as the check reads the child's row. */
const CHECKED_AT = new Date('2026-11-23T10:15:30.250Z');

/** 小米 of 林悦的家 as the child sees itself. */
const XIAOMI: ChildProfile = {
  familyId: FAMILY_ID,
  familyName: '林悦的家',
  nickname: '小米',
  account: 'xiaomi',
};

/** The issue time of a login issued at the given time, as the JWT carries it: cut to whole seconds. */
function issuedAt(iso: string): Date {
  return new Date(Math.floor(new Date(iso).getTime() / 1000) * 1000);
}

/** A login issued at the given time. */
function sessionIssuedAt(iso: string): ChildSession {
  const issued = issuedAt(iso);
  return {
    childId: CHILD_ID,
    issuedAt: issued,
    expiresAt: new Date(issued.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

describe('issuedSinceLastReset', () => {
  it.each<[string, string, boolean]>([
    ['in the second after the reset', '2026-11-22T09:00:06.000Z', true],
    ['a day after the reset', '2026-11-23T09:00:05.100Z', true],
    ['in the same second as the reset, before it', '2026-11-22T09:00:05.300Z', false],
    ['in the second before the reset', '2026-11-22T09:00:04.999Z', false],
    ['a day before the reset', '2026-11-21T09:00:05.900Z', false],
  ])('after a reset, counts a login issued %s: %s', (_case, issued, counts) => {
    expect(issuedSinceLastReset(issuedAt(issued), RESET_VALID_AFTER)).toBe(counts);
  });

  it("counts a login issued in the second the child was added in, the creation's exact time stored", () => {
    const created = new Date('2026-11-22T09:00:05.700Z');

    expect(issuedSinceLastReset(issuedAt('2026-11-22T09:00:05.900Z'), created)).toBe(true);
    expect(issuedSinceLastReset(issuedAt('2026-11-22T09:00:04.900Z'), created)).toBe(false);
  });
});

describe('ChildService', () => {
  const sessionCheck = vi.fn<ChildLoginRepository['sessionCheck']>();
  const findProfile = vi.fn<ChildLoginRepository['findProfile']>();
  const updateChild = vi.fn<ChildStore['updateChild']>();
  const record = vi.fn<AuditService['record']>();
  const transaction = {} as Executor;
  const service = new ChildService(
    { sessionCheck, findProfile } as unknown as ChildLoginRepository,
    {
      transaction: (work: (store: ChildStore, executor: Executor) => Promise<unknown>) =>
        work({ updateChild } as unknown as ChildStore, transaction),
    } as unknown as ChildrenRepository,
    { record } as unknown as AuditService,
  );

  beforeEach(() => {
    sessionCheck.mockReset();
    findProfile.mockReset();
    updateChild.mockReset();
    record.mockReset();
  });

  describe('currentAt', () => {
    it("accepts a login of a child who exists, issued since the last reset, at the database's time of the check", async () => {
      sessionCheck.mockResolvedValue({
        sessionsValidAfter: RESET_VALID_AFTER,
        checkedAt: CHECKED_AT,
      });

      await expect(service.currentAt(sessionIssuedAt('2026-11-22T09:00:06.100Z'))).resolves.toEqual(
        CHECKED_AT,
      );
      expect(sessionCheck).toHaveBeenCalledWith(CHILD_ID);
    });

    it('refuses a login issued before the last reset, in the same second as well', async () => {
      sessionCheck.mockResolvedValue({
        sessionsValidAfter: RESET_VALID_AFTER,
        checkedAt: CHECKED_AT,
      });

      await expect(
        service.currentAt(sessionIssuedAt('2026-11-22T09:00:05.300Z')),
      ).resolves.toBeUndefined();
      await expect(
        service.currentAt(sessionIssuedAt('2026-11-22T09:00:04.900Z')),
      ).resolves.toBeUndefined();
    });

    it('refuses a login of a child who has been deleted', async () => {
      sessionCheck.mockResolvedValue(undefined);

      await expect(
        service.currentAt(sessionIssuedAt('2026-11-22T09:00:06.000Z')),
      ).resolves.toBeUndefined();
    });
  });

  describe('me', () => {
    it('answers the signed-in child with the account and the family’s name', async () => {
      findProfile.mockResolvedValue(XIAOMI);

      await expect(service.me(CHILD_ID)).resolves.toEqual({
        id: CHILD_ID,
        nickname: '小米',
        account: 'xiaomi',
        familyName: '林悦的家',
      });
      expect(findProfile).toHaveBeenCalledWith(CHILD_ID);
    });

    it('answers a child deleted since the login check as no login', async () => {
      findProfile.mockResolvedValue(undefined);

      await expect(service.me(CHILD_ID)).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });

  describe('rename', () => {
    it('changes the nickname within the child’s family and records the child as the one who did', async () => {
      findProfile.mockResolvedValue(XIAOMI);
      updateChild.mockResolvedValue({
        id: CHILD_ID,
        nickname: '米米',
        account: 'xiaomi',
        passwordSet: true,
        passwordSetupUntil: null,
      });

      await expect(service.rename(CHILD_ID, '米米')).resolves.toEqual({
        id: CHILD_ID,
        nickname: '米米',
        account: 'xiaomi',
        familyName: '林悦的家',
      });
      expect(updateChild).toHaveBeenCalledWith(FAMILY_ID, CHILD_ID, { nickname: '米米' });
      expect(record).toHaveBeenCalledWith(transaction, {
        actor: { kind: 'child', id: CHILD_ID },
        action: 'child.updated',
        targetId: CHILD_ID,
        familyId: FAMILY_ID,
        details: { fields: ['nickname'] },
      });
    });

    it('answers a child deleted before the change as no login, changing and recording nothing', async () => {
      findProfile.mockResolvedValue(undefined);

      await expect(service.rename(CHILD_ID, '米米')).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      expect(updateChild).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('answers a child deleted during the change as no login, recording nothing', async () => {
      findProfile.mockResolvedValue(XIAOMI);
      updateChild.mockResolvedValue(undefined);

      await expect(service.rename(CHILD_ID, '米米')).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      expect(record).not.toHaveBeenCalled();
    });
  });
});
