import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import { CHILD_SESSION_COOKIE, ID_TOKEN_COOKIE, PARENT_SESSION_COOKIE } from './session-cookies.js';

const LOGOUT_URL = 'https://idp.example.com/logout?client_id=client-1';

function createController(endSessionUrl: (idToken: string | undefined) => Promise<string>) {
  const authService = { endSessionUrl: vi.fn(endSessionUrl) };
  const controller = new AuthController(authService as unknown as AuthService);
  const response = { clearCookie: vi.fn() };
  return { controller, authService, response, asResponse: response as unknown as Response };
}

const requestWith = (cookies: Record<string, string>) => ({ cookies }) as unknown as Request;

describe('AuthController.logout', () => {
  it("returns the logout address for the ID token and clears only the parent's two login cookies", async () => {
    const { controller, authService, response, asResponse } = createController(() =>
      Promise.resolve(LOGOUT_URL),
    );

    await expect(
      controller.logout(
        requestWith({
          [PARENT_SESSION_COOKIE]: 'session-1',
          [ID_TOKEN_COOKIE]: 'id-token-1',
          [CHILD_SESSION_COOKIE]: 'child-session-1',
        }),
        asResponse,
      ),
    ).resolves.toEqual({ endSessionUrl: LOGOUT_URL });
    expect(authService.endSessionUrl).toHaveBeenCalledWith('id-token-1');
    expect(response.clearCookie.mock.calls.map(([name]) => name as unknown)).toEqual([
      PARENT_SESSION_COOKIE,
      ID_TOKEN_COOKIE,
    ]);
  });

  it('builds the address without an ID token when the browser has none', async () => {
    const { controller, authService, response, asResponse } = createController(() =>
      Promise.resolve(LOGOUT_URL),
    );

    await expect(controller.logout(requestWith({}), asResponse)).resolves.toEqual({
      endSessionUrl: LOGOUT_URL,
    });
    expect(authService.endSessionUrl).toHaveBeenCalledWith(undefined);
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('keeps the login cookies when the logout address cannot be built', async () => {
    const failure = new Error('discovery failed');
    const { controller, response, asResponse } = createController(() => Promise.reject(failure));

    await expect(
      controller.logout(
        requestWith({ [PARENT_SESSION_COOKIE]: 'session-1', [ID_TOKEN_COOKIE]: 'id-token-1' }),
        asResponse,
      ),
    ).rejects.toBe(failure);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
