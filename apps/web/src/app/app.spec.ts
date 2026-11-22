import { screen } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../testing/accessibility';
import { renderApp } from '../testing/app';
import { worker } from '../testing/network';
import {
  ERROR_NUMBER,
  LINYUE_WITHOUT_FAMILY,
  stubError,
  stubSignedIn,
  stubVisitor,
} from '../testing/sample-data';

describe('App', () => {
  describe('for a visitor', () => {
    beforeEach(() => {
      stubVisitor();
    });

    it.each(['/profile', '/start', '/join'])(
      'sends %s to the product home, which signs in back to it',
      async (path) => {
        const { router } = await renderApp(path);

        expect(router.url).toBe(`/?returnTo=${encodeURIComponent(path)}`);
        expect(screen.getByRole('link', { name: '家长登录 / 注册' }).getAttribute('href')).toBe(
          `/api/auth/login?returnTo=${encodeURIComponent(path)}`,
        );
        expect(screen.queryByRole('navigation')).toBeNull();
      },
    );

    it('opens the child login without a login', async () => {
      const { router } = await renderApp('/child');

      expect(router.url).toBe('/child');
      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
    });

    it('sends an unknown address to the product home', async () => {
      const { router } = await renderApp('/nothing-here');

      expect(router.url).toBe('/');
    });
  });

  describe('for a signed-in parent', () => {
    it('shows the home page inside the menus, titled with the product name', async () => {
      stubSignedIn();
      await renderApp('/');

      expect(document.title).toBe('好奇星球');
      expect(screen.getAllByRole('navigation', { name: '主菜单' }).length).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: '家长登录 / 注册' })).toBeNull();
      await expectNoAxeViolations();
    });

    it('shows the child login as it is, without the menus', async () => {
      stubSignedIn();
      const { router } = await renderApp('/child');

      expect(router.url).toBe('/child');
      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('sends a parent with a family from the start page to the home page', async () => {
      stubSignedIn();
      const { router } = await renderApp('/start');

      expect(router.url).toBe('/');
      expect(screen.getByText('欢迎回来，林悦')).toBeTruthy();
    });

    it('opens the join page, titled 加入家庭, for a parent with a family', async () => {
      stubSignedIn();
      const { router } = await renderApp('/join');

      expect(router.url).toBe('/join');
      expect(document.title).toBe('加入家庭 - 好奇星球');
    });

    it.each(['/', '/join'])(
      'sends a parent without a family from %s to the start page',
      async (path) => {
        stubSignedIn(LINYUE_WITHOUT_FAMILY, []);
        const { router } = await renderApp(path);

        expect(router.url).toBe('/start');
        expect(screen.queryByRole('navigation')).toBeNull();
      },
    );

    it('keeps a parent without a family on the start page', async () => {
      stubSignedIn(LINYUE_WITHOUT_FAMILY, []);
      const { router } = await renderApp('/start');

      expect(router.url).toBe('/start');
    });

    it('goes back to the product home when the login has expired, keeping the page', async () => {
      stubSignedIn();
      const { router, fixture } = await renderApp('/');
      stubError('get /api/me', 401, 'unauthenticated');

      await router.navigateByUrl('/profile');
      await fixture.whenStable();

      await vi.waitFor(() => {
        expect(router.url).toBe('/?returnTo=%2Fprofile');
      });
      expect(
        (await screen.findByRole('link', { name: '家长登录 / 注册' })).getAttribute('href'),
      ).toBe('/api/auth/login?returnTo=%2Fprofile');
      expect(screen.queryByRole('navigation')).toBeNull();
    });
  });

  describe('when the parent cannot be loaded', () => {
    it('says the page did not open, with the error number, and retries', async () => {
      stubError('get /api/me', 500, 'internal');
      const { router, fixture } = await renderApp('/profile');

      expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
      expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();
      await expectNoAxeViolations();

      stubSignedIn();
      await userEvent.click(screen.getByRole('button', { name: '重试' }));
      await fixture.whenStable();

      await vi.waitFor(() => {
        expect(router.url).toBe('/profile');
      });
      expect(await screen.findByRole('heading', { name: '个人设置' })).toBeTruthy();
    });

    it('says so without an error number when there is no network', async () => {
      worker.use(http.get('/api/me', () => HttpResponse.error()));
      await renderApp('/');

      expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
      expect(screen.queryByText(/错误编号/)).toBeNull();
    });
  });
});
