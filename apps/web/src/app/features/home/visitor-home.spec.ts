import { screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { emulateReducedMotion, nextFrames } from '../../../testing/pointer';
import { stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

describe('VisitorHome', () => {
  beforeEach(() => {
    stubVisitor();
  });

  it('shows the product, the parents’ way in and the children’s', async () => {
    await renderApp('/');

    expect(document.title).toBe('好奇星球');
    expect(screen.getByRole('img', { name: '好奇星球' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('把难懂的课');
    expect(screen.getByText('给 3–18 岁的孩子')).toBeTruthy();
    expect(screen.getByRole('link', { name: '家长登录 / 注册' }).getAttribute('href')).toBe(
      '/api/auth/login',
    );
    expect(screen.getByRole('link', { name: '孩子登录' }).getAttribute('href')).toBe('/child');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('home-visitor');
  });

  it('signs in towards the page that was wanted', async () => {
    await renderApp('/?returnTo=%2Fprofile');

    expect(screen.getByRole('link', { name: '家长登录 / 注册' }).getAttribute('href')).toBe(
      '/api/auth/login?returnTo=%2Fprofile',
    );
  });

  it('ignores a return address on another site', async () => {
    await renderApp('/?returnTo=%2F%2Fevil.example');

    expect(screen.getByRole('link', { name: '家长登录 / 注册' }).getAttribute('href')).toBe(
      '/api/auth/login',
    );
  });

  it('opens the child login', async () => {
    const { router, fixture } = await renderApp('/');

    await userEvent.click(screen.getByRole('link', { name: '孩子登录' }));
    await fixture.whenStable();

    expect(router.url).toBe('/child');
  });

  it.each([0, 150, 350, 600])('enters with the rabbit and its bubble, at %i ms', async (time) => {
    await renderApp('/');

    await expectScreenshotsAtEverySize(
      `home-visitor-entering-${String(time).padStart(4, '0')}ms`,
      undefined,
      { heldAt: time },
    );
  });

  it('keeps the rabbit floating, but not with reduced motion', async () => {
    await renderApp('/');
    const floating = () =>
      document
        .getAnimations()
        .some((animation) => (animation as CSSAnimation).animationName === 'bob');

    expect(floating()).toBe(true);

    await emulateReducedMotion(true);
    await nextFrames();

    expect(floating()).toBe(false);
  });

  describe('after a failed sign-in', () => {
    it('says so in a dialog that offers another try', async () => {
      await renderApp('/?login=failed');

      const dialog = await screen.findByRole('dialog', { name: '登录没有成功' });
      expect(dialog.textContent).toContain('请再试一次。');
      expect(screen.getByRole('link', { name: '再试一次' }).getAttribute('href')).toBe(
        '/api/auth/login',
      );
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('error-login');
    });

    it('closes with 关闭 and forgets the failure', async () => {
      const { router, fixture } = await renderApp('/?login=failed');

      await userEvent.click(await screen.findByRole('button', { name: '关闭' }));
      await fixture.whenStable();

      expect(router.url).toBe('/');
      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('closes with Escape', async () => {
      const { router, fixture } = await renderApp('/?login=failed');
      await screen.findByRole('dialog');

      await userEvent.keyboard('{Escape}');
      await fixture.whenStable();

      expect(router.url).toBe('/');
    });
  });
});
