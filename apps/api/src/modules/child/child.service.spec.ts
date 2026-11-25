import type { ChildSession } from '../auth/child-session.service.js';
import type { ChildLoginRepository } from './child-login.repository.js';
import { ChildService, issuedSinceLastReset } from './child.service.js';

const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
/** What a password reset at 09:00:05.700 by the database's clock stores: the next whole second. */
const RESET_VALID_AFTER = new Date('2026-11-22T09:00:06.000Z');
/** The database's clock as the check reads the child's row. */
const CHECKED_AT = new Date('2026-11-23T10:15:30.250Z');

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
  const findNickname = vi.fn<ChildLoginRepository['findNickname']>();
  const service = new ChildService({
    sessionCheck,
    findNickname,
  } as unknown as ChildLoginRepository);

  beforeEach(() => {
    sessionCheck.mockReset();
    findNickname.mockReset();
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
    it('answers the signed-in child', async () => {
      findNickname.mockResolvedValue('小米');

      await expect(service.me(CHILD_ID)).resolves.toEqual({ id: CHILD_ID, nickname: '小米' });
    });

    it('answers a child deleted since the login check as no login', async () => {
      findNickname.mockResolvedValue(undefined);

      await expect(service.me(CHILD_ID)).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });
});
