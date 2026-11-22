import { errorResponseSchema, logoutResponseSchema } from '@thinklet/contracts';
import { expectAccessiblePage } from '../support/accessibility.ts';
import { familyOfLinyue } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import {
  endpointOf,
  expectConfiguredAuthorization,
  providerEndpoints,
  requireIdentityProvider,
} from '../support/identity-provider.ts';
import { newUser, providerLoginForm, signIn, signInAtProvider } from '../support/sign-in.ts';

/** A site that is not this one, as the Origin of a forged request. */
const ANOTHER_SITE = 'https://evil.example';

/** Anything but an empty string. */
const PRESENT = /.+/;

// Signing in and out (.docs/design/rules.md, 登录和登录状态;
// .docs/design/interfaces.md, 通用约定 and 登录). The endpoints are checked
// the way a deployed site answers them, without signing in and without
// changing anything, so they also run as smoke tests on production; the
// flows sign in through the mock identity provider's login page.
test.describe('the login endpoints', () => {
  test(
    'GET /api/auth/login sends the browser to the identity provider to sign in with PKCE',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request, baseURL }) => {
      const response = await request.get('/api/auth/login', { maxRedirects: 0 });

      expect(response.status()).toBe(302);
      const location = new URL(response.headers()['location'] ?? '');
      expect(location.origin).not.toBe(new URL(baseURL ?? '').origin);
      expect(Object.fromEntries(location.searchParams)).toMatchObject({
        response_type: 'code',
        code_challenge_method: 'S256',
        code_challenge: expect.stringMatching(/^[\w-]{43}$/),
        state: expect.stringMatching(PRESENT),
        nonce: expect.stringMatching(PRESENT),
        client_id: expect.stringMatching(PRESENT),
        scope: expect.stringMatching(/\bopenid\b/),
        redirect_uri: new URL('/api/auth/callback', baseURL).href,
      });
      await expectConfiguredAuthorization(request, location);
    },
  );

  test(
    'GET /api/me without a login answers 401 unauthenticated',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.get('/api/me');

      expect(response.status()).toBe(401);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe('unauthenticated');
    },
  );

  test(
    'POST /api/auth/logout from another site answers 403 bad_origin',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.post('/api/auth/logout', {
        headers: { Origin: ANOTHER_SITE },
      });

      expect(response.status()).toBe(403);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe('bad_origin');
      expect(response.headers()['set-cookie']).toBeUndefined();
    },
  );

  // A write sent from the site itself reaches the api through the web
  // origin's /api forwarding with its Origin intact; a forwarding that
  // changed it would turn every write of the site into 403 bad_origin.
  // Logout needs no login and, without one, changes nothing.
  test(
    'POST /api/auth/logout from the site itself without a login answers 200 with the logout address',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request, baseURL }) => {
      const origin = new URL(baseURL ?? '').origin;

      const response = await request.post('/api/auth/logout', { headers: { Origin: origin } });

      expect(response.status()).toBe(200);
      const endSession = new URL(logoutResponseSchema.parse(await response.json()).endSessionUrl);
      expect(endSession.origin).not.toBe(origin);
      expect(endSession.searchParams.get('post_logout_redirect_uri')).toBe(`${origin}/`);
      expect(endSession.searchParams.has('id_token_hint')).toBe(false);
    },
  );
});

test.describe('signing in and out', () => {
  test('a visitor who opens an invitation link signs in from the product home and comes back to it', async ({
    page,
    openParentPage,
  }) => {
    const { family } = await familyOfLinyue(openParentPage);
    const link = `/join/${family.code}`;

    await page.goto(link);
    await expect(page).toHaveURL(`/?returnTo=${encodeURIComponent(link)}`);
    await page.getByRole('link', { name: '家长登录 / 注册' }).click();
    await signInAtProvider(page, newUser('周子航'));

    await expect(page).toHaveURL(link);
    const confirm = page.getByRole('dialog', { name: '申请加入这个家庭？' });
    await expect(confirm.getByText('林悦的家')).toBeVisible();
    await expect(confirm.getByText('管理员 林悦')).toBeVisible();
  });

  test('a login that does not succeed lands on the product home with 登录没有成功, and another try signs in', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '家长登录 / 注册' }).click();
    await expect(providerLoginForm(page)).toBeVisible();

    // A parent who cancels at the provider is sent back with an error.
    const state = new URL(page.url()).searchParams.get('state') ?? '';
    await page.goto(`/api/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`);

    await expect(page).toHaveURL('/?login=failed');
    const dialog = page.getByRole('dialog', { name: '登录没有成功' });
    await expect(dialog).toBeVisible();
    await expectAccessiblePage(page);
    await dialog.getByRole('link', { name: '再试一次' }).click();
    await signInAtProvider(page, newUser('林悦'));
    await expect(page).toHaveURL('/start');
  });

  test('signing out ends the login here and at the identity provider, and parent pages need a new login', async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const provider = requireIdentityProvider();
    const { endSession } = await providerEndpoints(request, provider.issuer);
    const user = newUser('林悦');
    await signIn(page, user, '/profile');
    const idToken = (await context.cookies()).find(({ name }) => name === 'thinklet_id_token');

    const leaving = page.waitForRequest(
      (sent) => sent.isNavigationRequest() && endpointOf(new URL(sent.url())) === endSession,
    );
    await page.getByRole('button', { name: '退出登录' }).click();

    expect(Object.fromEntries(new URL((await leaving).url()).searchParams)).toEqual({
      id_token_hint: idToken?.value,
      client_id: provider.clientId,
      post_logout_redirect_uri: `${baseURL ?? ''}/`,
    });
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: '家长登录 / 注册' })).toBeVisible();
    const left = (await context.cookies()).map(({ name }) => name);
    expect(left).not.toContain('thinklet_session');
    expect(left).not.toContain('thinklet_id_token');
    const me = await page.request.get('/api/me');
    expect(me.status()).toBe(401);
    expect(errorResponseSchema.parse(await me.json()).error.code).toBe('unauthenticated');

    await page.goto('/profile');
    await expect(page).toHaveURL('/?returnTo=%2Fprofile');
    await page.getByRole('link', { name: '家长登录 / 注册' }).click();
    await expect(providerLoginForm(page)).toBeVisible();
    await signInAtProvider(page, user);
    await expect(page).toHaveURL('/profile');
    await expect(page.getByRole('heading', { level: 1, name: '个人设置' })).toBeVisible();
  });
});
