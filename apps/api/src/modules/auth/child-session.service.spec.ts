import type { Request, Response } from 'express';
import { currentChildIdOf } from '../../infrastructure/authentication/current-child.js';
import { ChildSessionService, type ChildSession } from './child-session.service.js';
import type { Session, SessionTokensService } from './session-tokens.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-22T09:00:00Z');
const RENEWED = 'child-session-2';

/** The service over a token service whose every child cookie verifies to `session`. */
function setUp(session: Session | undefined, cookies: Record<string, string> = {}) {
  const request = { cookies } as unknown as Request;
  const response = { cookie: vi.fn(), clearCookie: vi.fn() };
  const issueSession = vi.fn(() => Promise.resolve(RENEWED));
  const verifySession = vi.fn(() => Promise.resolve(session));
  const service = new ChildSessionService({
    issueSession,
    verifySession,
  } as unknown as SessionTokensService);
  return {
    service,
    tokens: { issueSession, verifySession },
    request,
    response,
    asResponse: response as unknown as Response,
  };
}

/** A child login issued `daysAgo` days before `now`. */
const issuedDaysAgo = (daysAgo: number): Session => ({
  id: 'child-1',
  issuedAt: new Date(now.getTime() - daysAgo * DAY_MS),
  expiresAt: new Date(now.getTime() + (7 - daysAgo) * DAY_MS),
});

const childCookie = { thinklet_child_session: 'child-session-1' };

/** The child module's check of the child, accepting every child. */
const acceptingCheck = () =>
  vi.fn<(session: ChildSession) => Promise<boolean>>(() => Promise.resolve(true));

describe('ChildSessionService', () => {
  it("signs a child in with a child JWT in the child's own 7-day cookie", async () => {
    const { service, tokens, response, asResponse } = setUp(undefined);

    await service.signIn(asResponse, 'child-1', now);

    expect(tokens.issueSession).toHaveBeenCalledWith('child', 'child-1', now);
    expect(response.cookie).toHaveBeenCalledTimes(1);
    expect(response.cookie).toHaveBeenCalledWith('thinklet_child_session', RENEWED, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * DAY_MS,
    });
  });

  it("signs a child out by clearing only the child's cookie", () => {
    const { service, response, asResponse } = setUp(undefined);

    service.signOut(asResponse);

    expect(response.clearCookie.mock.calls).toEqual([
      ['thinklet_child_session', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }],
    ]);
  });

  describe('verify', () => {
    it('reads the child cookie as a child login, giving the child and the issue time', async () => {
      const session = issuedDaysAgo(1);
      const { service, tokens, request } = setUp(session, {
        ...childCookie,
        thinklet_session: 'parent-session-1',
      });

      await expect(service.verify(request, now)).resolves.toEqual({
        childId: 'child-1',
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
      });
      expect(tokens.verifySession).toHaveBeenCalledTimes(1);
      expect(tokens.verifySession).toHaveBeenCalledWith('child-session-1', 'child', now);
    });

    it('is undefined without a valid child login', async () => {
      const { service, tokens, request } = setUp(undefined, { thinklet_session: 'parent-1' });

      await expect(service.verify(request, now)).resolves.toBeUndefined();
      expect(tokens.verifySession).toHaveBeenCalledWith(undefined, 'child', now);
    });
  });

  describe('authenticate', () => {
    it('records a current child on the request and leaves a fresh login as it is', async () => {
      const { service, request, response, asResponse } = setUp(issuedDaysAgo(1), childCookie);
      const isCurrent = acceptingCheck();

      await service.authenticate(request, asResponse, isCurrent, now);

      expect(isCurrent).toHaveBeenCalledWith(expect.objectContaining({ childId: 'child-1' }));
      expect(currentChildIdOf(request)).toBe('child-1');
      expect(response.cookie).not.toHaveBeenCalled();
    });

    it('renews a current login with less than 3.5 days left for 7 days', async () => {
      const { service, tokens, request, response, asResponse } = setUp(
        issuedDaysAgo(4),
        childCookie,
      );

      await service.authenticate(request, asResponse, acceptingCheck(), now);

      expect(tokens.issueSession).toHaveBeenCalledWith('child', 'child-1', now);
      expect(response.cookie).toHaveBeenCalledWith(
        'thinklet_child_session',
        RENEWED,
        expect.objectContaining({ maxAge: 7 * DAY_MS, httpOnly: true }),
      );
    });

    it('refuses a request without a valid child login with 401, asking nothing about the child', async () => {
      const { service, request, asResponse } = setUp(undefined);
      const isCurrent = acceptingCheck();

      await expect(service.authenticate(request, asResponse, isCurrent, now)).rejects.toMatchObject(
        { code: 'unauthenticated', status: 401 },
      );
      expect(isCurrent).not.toHaveBeenCalled();
      expect(() => currentChildIdOf(request)).toThrow();
    });

    it('refuses a login the child check does not accept, without renewing it', async () => {
      const { service, tokens, request, response, asResponse } = setUp(
        issuedDaysAgo(4),
        childCookie,
      );

      await expect(
        service.authenticate(request, asResponse, () => Promise.resolve(false), now),
      ).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
      expect(tokens.issueSession).not.toHaveBeenCalled();
      expect(response.cookie).not.toHaveBeenCalled();
      expect(() => currentChildIdOf(request)).toThrow();
    });
  });
});
