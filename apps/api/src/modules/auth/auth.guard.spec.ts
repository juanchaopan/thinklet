import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ChildRoute } from '../../infrastructure/authentication/child-route.decorator.js';
import { currentParentIdOf } from '../../infrastructure/authentication/current-parent.js';
import { ParentOrChildRoute } from '../../infrastructure/authentication/parent-or-child-route.decorator.js';
import { Public } from '../../infrastructure/authentication/public.decorator.js';
import { AuthGuard } from './auth.guard.js';
import { ParentSessionService } from './parent-session.service.js';
import type { Session, SessionTokensService } from './session-tokens.service.js';

@Public()
class OpenController {}

@ChildRoute()
class ChildController {}

@ParentOrChildRoute()
class SharedController {}

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
  const guard = new AuthGuard(
    new Reflector(),
    new ParentSessionService(tokens as unknown as SessionTokensService),
  );
  return {
    tokens,
    request,
    response,
    closed: () => guard.canActivate(contextFor(ClosedController)),
    open: () => guard.canActivate(contextFor(OpenController)),
    child: () => guard.canActivate(contextFor(ChildController)),
    shared: () => guard.canActivate(contextFor(SharedController)),
  };
}

const sessionExpiringIn = (ms: number): Session => ({
  id: 'parent-1',
  issuedAt: new Date(Date.now() + ms - 7 * DAY_MS),
  expiresAt: new Date(Date.now() + ms),
});

describe('AuthGuard', () => {
  it('lets a public route through without a login', async () => {
    const { open, tokens } = setUp(undefined);

    await expect(open()).resolves.toBe(true);
    expect(tokens.verifySession).not.toHaveBeenCalled();
  });

  it("leaves a child route to the child's login check, asking for no parent", async () => {
    const { child, tokens, response } = setUp(undefined, {
      thinklet_child_session: 'child-session-1',
    });

    await expect(child()).resolves.toBe(true);
    expect(tokens.verifySession).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("leaves a route for a parent or a child to the route's own check", async () => {
    const { shared, tokens, response } = setUp(undefined);

    await expect(shared()).resolves.toBe(true);
    expect(tokens.verifySession).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('refuses any other route without a valid login with 401 unauthenticated', async () => {
    const { closed } = setUp(undefined, { thinklet_session: 'bad' });

    await expect(closed()).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it("verifies only the parent's cookie, as a parent login, and records the parent", async () => {
    const { closed, tokens, request, response } = setUp(sessionExpiringIn(6 * DAY_MS), {
      thinklet_session: 'session-1',
      thinklet_child_session: 'child-session-1',
    });

    await expect(closed()).resolves.toBe(true);
    expect(tokens.verifySession).toHaveBeenCalledTimes(1);
    expect(tokens.verifySession).toHaveBeenCalledWith('session-1', 'parent', expect.any(Date));
    expect(currentParentIdOf(request)).toBe('parent-1');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("refuses a browser with only a child's login", async () => {
    const { closed, tokens } = setUp(undefined, { thinklet_child_session: 'child-session-1' });

    await expect(closed()).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(tokens.verifySession).toHaveBeenCalledWith(undefined, 'parent', expect.any(Date));
  });

  it('renews a login with less than 3.5 days left as a parent login, with the ID token', async () => {
    const { closed, tokens, response } = setUp(sessionExpiringIn(3 * DAY_MS), {
      thinklet_session: 'session-1',
      thinklet_id_token: 'id-token-1',
    });

    await closed();

    expect(tokens.issueSession).toHaveBeenCalledWith('parent', 'parent-1', expect.any(Date));
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
