import { screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../testing/accessibility';
import { pageAtTop, renderAsLinyue } from '../../testing/books';
import { stubLibrary } from '../../testing/library';
import { expectScreenshotsAtEverySize } from '../../testing/screenshots';

const welcome = () => screen.queryByRole('heading', { level: 1, name: '欢迎回来，林悦' });

/** Opens `/?login=failed` as 林悦, once the library behind the dialog is there. */
async function renderFailedSignIn() {
  stubLibrary();
  const rendered = await renderAsLinyue('/?login=failed');
  await screen.findByRole('heading', { level: 1, name: '欢迎回来，林悦' });
  await screen.findByRole('link', { name: '胡萝卜数数大冒险' });
  return rendered;
}

// The product home's dialog, for a visitor, is tested with the product home.
describe('LoginFailedDialog over the library', () => {
  it('says the sign-in failed over the library of a parent still signed in, offering another try', async () => {
    await renderFailedSignIn();

    const dialog = await screen.findByRole('dialog', { name: '登录没有成功' });
    expect(dialog.textContent).toContain('请再试一次。');
    expect(within(dialog).getByRole('link', { name: '再试一次' }).getAttribute('href')).toBe(
      '/api/auth/login',
    );
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('library-error-login', undefined, { prepare: pageAtTop });
  });

  it.each<[string, () => Promise<void>]>([
    ['关闭', async () => userEvent.click(await screen.findByRole('button', { name: '关闭' }))],
    [
      'Escape',
      async () => {
        await screen.findByRole('dialog', { name: '登录没有成功' });
        await userEvent.keyboard('{Escape}');
      },
    ],
  ])('closes with %s, leaving the library at /', async (_how, close) => {
    const { router, fixture } = await renderFailedSignIn();

    await close();
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.url).toBe('/');
    expect(welcome()).toBeTruthy();
  });

  it('is not there without the failure in the address', async () => {
    stubLibrary();
    await renderAsLinyue('/');

    expect(await screen.findByRole('heading', { level: 1, name: '欢迎回来，林悦' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
