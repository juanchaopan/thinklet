import { Logger } from '@nestjs/common';
import { calculatePKCECodeChallenge } from 'openid-client';
import type { MockInstance } from 'vitest';
import type { FamilyService } from '../family/family.service.js';
import { AuthService } from './auth.service.js';
import type { CompletedLogin, OidcService } from './oidc.service.js';
import type { LoginTransaction, SessionTokensService } from './session-tokens.service.js';

const claims = {
  iss: 'https://idp.example.com',
  sub: 'subject-1',
  aud: 'client-1',
  iat: 0,
  exp: 0,
  name: '林悦',
  email: 'linyue@example.com',
};

const transaction: LoginTransaction = {
  state: 'state-1',
  nonce: 'nonce-1',
  codeVerifier: 'verifier-1',
  returnTo: '/profile',
};

function createService() {
  const oidc = {
    authorizationUrl: vi.fn(() => Promise.resolve('https://idp.example.com/authorize?x=1')),
    completeLogin: vi.fn<() => Promise<CompletedLogin>>(() =>
      Promise.resolve({ idToken: 'id-token-1', claims }),
    ),
    endSessionUrl: vi.fn(() => Promise.resolve('https://idp.example.com/logout')),
  };
  const tokens = {
    issueLoginTransaction: vi.fn<(kept: LoginTransaction) => Promise<string>>(() =>
      Promise.resolve('login-1'),
    ),
    verifyLoginTransaction: vi.fn<() => Promise<LoginTransaction | undefined>>(() =>
      Promise.resolve(transaction),
    ),
    issueSession: vi.fn(() => Promise.resolve('session-1')),
  };
  const family = { recordLogin: vi.fn(() => Promise.resolve('parent-1')) };
  const service = new AuthService(
    oidc as unknown as OidcService,
    tokens as unknown as SessionTokensService,
    family as unknown as FamilyService,
  );
  return { service, oidc, tokens, family };
}

describe('AuthService', () => {
  let warn: MockInstance<Logger['warn']>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Everything the service logged, as one text. */
  const loggedText = () => JSON.stringify(warn.mock.calls);

  describe('startLogin', () => {
    it('sends the parent on with a fresh state, nonce and S256 challenge of the kept verifier', async () => {
      const { service, oidc, tokens } = createService();

      const started = await service.startLogin('/profile');

      expect(started).toEqual({
        ok: true,
        authorizationUrl: 'https://idp.example.com/authorize?x=1',
        loginTransactionToken: 'login-1',
      });
      const kept = tokens.issueLoginTransaction.mock.calls[0]?.[0];
      expect(kept).toMatchObject({ returnTo: '/profile' });
      expect(oidc.authorizationUrl).toHaveBeenCalledWith({
        state: kept?.state,
        nonce: kept?.nonce,
        codeChallenge: await calculatePKCECodeChallenge(kept?.codeVerifier ?? ''),
      });
    });

    it('makes new values for every login', async () => {
      const { service, tokens } = createService();

      await service.startLogin('/');
      await service.startLogin('/');

      const [first, second] = tokens.issueLoginTransaction.mock.calls.map(([kept]) => kept);
      expect(second?.state).not.toBe(first?.state);
      expect(second?.nonce).not.toBe(first?.nonce);
      expect(second?.codeVerifier).not.toBe(first?.codeVerifier);
    });

    it('returns to / when the page is on another site', async () => {
      const { service, tokens } = createService();

      await service.startLogin('//evil.example');

      expect(tokens.issueLoginTransaction.mock.calls[0]?.[0]).toMatchObject({ returnTo: '/' });
    });

    it('does not start when the identity provider cannot be reached, and logs why', async () => {
      const { service, oidc } = createService();
      oidc.authorizationUrl.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.startLogin('/')).resolves.toEqual({ ok: false });
      expect(warn).toHaveBeenCalledWith(
        { error: { name: 'Error', message: 'connect ECONNREFUSED' } },
        'Login could not start',
      );
    });
  });

  describe('completeLogin', () => {
    it('checks the callback against the login, records it and issues a parent session', async () => {
      const { service, oidc, tokens, family } = createService();

      const completed = await service.completeLogin('login-1', '?code=code-1&state=state-1');

      expect(completed).toEqual({
        ok: true,
        sessionToken: 'session-1',
        idToken: 'id-token-1',
        returnTo: '/profile',
      });
      expect(tokens.verifyLoginTransaction).toHaveBeenCalledWith('login-1');
      expect(oidc.completeLogin).toHaveBeenCalledWith('?code=code-1&state=state-1', transaction);
      expect(family.recordLogin).toHaveBeenCalledWith(claims.iss, claims.sub, claims);
      expect(tokens.issueSession).toHaveBeenCalledWith('parent', 'parent-1');
    });

    it('fails without asking the provider when the login cookie is not valid', async () => {
      const { service, oidc, tokens } = createService();
      tokens.verifyLoginTransaction.mockResolvedValue(undefined);

      await expect(service.completeLogin(undefined, '?code=code-1')).resolves.toEqual({
        ok: false,
      });
      expect(oidc.completeLogin).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        { error: { name: 'LoginTransactionError', message: expect.any(String) } },
        'Login failed',
      );
    });

    it('fails when the provider refuses the callback, logging no token or personal data', async () => {
      const { service, oidc, family } = createService();
      oidc.completeLogin.mockRejectedValue(
        new Error('unexpected "state" response parameter value'),
      );

      await expect(service.completeLogin('login-1', '?code=code-1')).resolves.toEqual({
        ok: false,
      });
      expect(family.recordLogin).not.toHaveBeenCalled();
      for (const value of ['code-1', 'login-1', 'state-1', 'nonce-1', 'verifier-1']) {
        expect(loggedText()).not.toContain(value);
      }
    });

    it('fails when the login cannot be recorded, logging no personal data', async () => {
      const { service, family, tokens } = createService();
      family.recordLogin.mockRejectedValue(new Error('database down'));

      await expect(service.completeLogin('login-1', '?code=code-1')).resolves.toEqual({
        ok: false,
      });
      expect(tokens.issueSession).not.toHaveBeenCalled();
      for (const value of [claims.name, claims.email, 'id-token-1']) {
        expect(loggedText()).not.toContain(value);
      }
    });
  });

  it('builds the logout address from the ID token', async () => {
    const { service, oidc } = createService();

    await expect(service.endSessionUrl('id-token-1')).resolves.toBe(
      'https://idp.example.com/logout',
    );
    expect(oidc.endSessionUrl).toHaveBeenCalledWith('id-token-1');
  });
});
