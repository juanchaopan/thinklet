import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { currentParentIdOf } from '../../infrastructure/authentication/current-parent.js';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { AuthGuard } from './auth.guard.js';
import type { Session, SessionTokensService } from './session-tokens.service.js';

@Public()
class OpenController {}

/** A controller with metadata of its own, but not marked public. */
@SetMetadata('thinklet:other', true)
class ClosedController {}

/** The route handler; the login check reads only the metadata of the controller here. */
function handler(): void {}

const DAY_MS = 24 * 60 * 60 * 1000;

function setUp(session: Session | undefined, cookies: Record<string, string> = {}) {
  const tokens = {
    verifySession: vi.fn(() => Promise.resolve(session)),
    issueSession: vi.fn(() => Promise.resolve('renewed-session')),
  };
  const request = { cookies } as unknown as Request;
  const response = { cookie: vi.fn() };
  const contextFor = (controller: object): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    }) as unknown as ExecutionContext;
  const guard = new AuthGuard(new Reflector(), tokens as unknown as SessionTokensService);
  return {
    tokens,
    request,
    response,
    closed: () => guard.canActivate(contextFor(ClosedController)),
    open: () => guard.canActivate(contextFor(OpenController)),
  };
}

const sessionExpiringIn = (ms: number): Session => ({
  parentId: 'parent-1',
  expiresAt: new Date(Date.now() + ms),
});

describe('AuthGuard', () => {
  it('lets a public route through without a login', async () => {
    const { open, tokens } = setUp(undefined);

    await expect(open()).resolves.toBe(true);
    expect(tokens.verifySession).not.toHaveBeenCalled();
  });

  it('refuses any other route without a valid login with 401 unauthenticated', async () => {
    const { closed } = setUp(undefined, { thinklet_session: 'bad' });

    await expect(closed()).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('verifies the session cookie and records the parent on the request', async () => {
    const { closed, tokens, request, response } = setUp(sessionExpiringIn(6 * DAY_MS), {
      thinklet_session: 'session-1',
    });

    await expect(closed()).resolves.toBe(true);
    expect(tokens.verifySession).toHaveBeenCalledWith('session-1', expect.any(Date));
    expect(currentParentIdOf(request)).toBe('parent-1');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('renews a login with less than 3.5 days left, with the ID token', async () => {
    const { closed, response } = setUp(sessionExpiringIn(3 * DAY_MS), {
      thinklet_session: 'session-1',
      thinklet_id_token: 'id-token-1',
    });

    await closed();

    expect(response.cookie).toHaveBeenCalledWith(
      'thinklet_session',
      'renewed-session',
      expect.objectContaining({ maxAge: 7 * DAY_MS, httpOnly: true }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'thinklet_id_token',
      'id-token-1',
      expect.objectContaining({ maxAge: 7 * DAY_MS, httpOnly: true }),
    );
  });

  it('renews only the session when the browser has no ID token', async () => {
    const { closed, response } = setUp(sessionExpiringIn(DAY_MS), {
      thinklet_session: 'session-1',
    });

    await closed();

    expect(response.cookie).toHaveBeenCalledTimes(1);
    expect(response.cookie).toHaveBeenCalledWith(
      'thinklet_session',
      'renewed-session',
      expect.any(Object),
    );
  });
});
