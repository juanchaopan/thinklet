import type { ChildSession } from '../auth/child-session.service.js';
import type { ChildLoginRepository } from './child-login.repository.js';
import { ChildService, issuedSinceLastReset } from './child.service.js';

const CHILD_ID = '3f9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const RESET = new Date('2026-11-22T09:00:05.700Z');

/** A login issued at the given time, as the JWT carries it: cut to whole seconds. */
function sessionIssuedAt(iso: string): ChildSession {
  const issuedAt = new Date(Math.floor(new Date(iso).getTime() / 1000) * 1000);
  return {
    childId: CHILD_ID,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

describe('issuedSinceLastReset', () => {
  it.each<[string, string, boolean]>([
    ['in a later second than the reset', '2026-11-22T09:00:06.100Z', true],
    ['in the same second as the reset, after it', '2026-11-22T09:00:05.900Z', true],
    ['in the same second as the reset, before it', '2026-11-22T09:00:05.300Z', true],
    ['in the second before the reset', '2026-11-22T09:00:04.999Z', false],
    ['a day before the reset', '2026-11-21T09:00:05.900Z', false],
  ])('counts a login issued %s: %s', (_case, issued, counts) => {
    expect(issuedSinceLastReset(sessionIssuedAt(issued).issuedAt, RESET)).toBe(counts);
  });

  it('counts a login of the second of a reset that fell on a whole second, and not of the one before', () => {
    const wholeSecond = new Date('2026-11-22T09:00:05.000Z');

    expect(issuedSinceLastReset(wholeSecond, wholeSecond)).toBe(true);
    expect(issuedSinceLastReset(new Date('2026-11-22T09:00:04.000Z'), wholeSecond)).toBe(false);
  });
});

describe('ChildService', () => {
  const sessionsValidAfter = vi.fn<ChildLoginRepository['sessionsValidAfter']>();
  const findNickname = vi.fn<ChildLoginRepository['findNickname']>();
  const service = new ChildService({
    sessionsValidAfter,
    findNickname,
  } as unknown as ChildLoginRepository);

  beforeEach(() => {
    sessionsValidAfter.mockReset();
    findNickname.mockReset();
  });

  describe('isCurrent', () => {
    it('accepts a login of a child who exists, issued since the last reset', async () => {
      sessionsValidAfter.mockResolvedValue(RESET);

      await expect(service.isCurrent(sessionIssuedAt('2026-11-22T09:00:05.900Z'))).resolves.toBe(
        true,
      );
      expect(sessionsValidAfter).toHaveBeenCalledWith(CHILD_ID);
    });

    it('refuses a login issued before the last reset', async () => {
      sessionsValidAfter.mockResolvedValue(RESET);

      await expect(service.isCurrent(sessionIssuedAt('2026-11-22T09:00:04.900Z'))).resolves.toBe(
        false,
      );
    });

    it('refuses a login of a child who has been deleted', async () => {
      sessionsValidAfter.mockResolvedValue(undefined);

      await expect(service.isCurrent(sessionIssuedAt('2026-11-22T09:00:06.000Z'))).resolves.toBe(
        false,
      );
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
