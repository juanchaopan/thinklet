import { screen } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { expectChildHome, stubChildSignedIn, stubRemembered } from '../../../testing/child-login';
import { backToFront, recordCalls } from '../../../testing/family-page';
import { holdNext } from '../../../testing/held-answers';
import { ERROR_NUMBER, stubError, stubNoChild, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

/** Opens the child's home page with 小明 signed in and no parent. */
async function renderChildHome() {
  stubVisitor();
  stubChildSignedIn();
  return renderApp('/child/home');
}

describe('ChildHome', () => {
  it('greets the child under a top bar with the child and 退出, with no books yet', async () => {
    await renderChildHome();

    expect(document.title).toBe('好奇星球');
    expect(screen.getByRole('img', { name: '好奇星球' })).toBeTruthy();
    const bar = screen.getByRole('banner');
    expect(bar.querySelector('app-avatar')?.textContent).toBe('小');
    expect(bar.querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
    expect(bar.textContent).toContain('小明');
    expect(screen.getByText('你好，小明！')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('我是小兔老师');
    expect(screen.getByRole('heading', { level: 2, name: '还没有书' })).toBeTruthy();
    expect(screen.getByText('家长给你分派书以后，会出现在这里。')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-home');
  });

  it('gives the welcome banner no entrance', async () => {
    await renderChildHome();

    const banner = document.querySelector('app-welcome-banner');
    expect(banner?.getAnimations({ subtree: true })).toEqual([]);
  });

  it('sends a browser without a signed-in child to the child login', async () => {
    stubVisitor();
    stubRemembered();
    const { router } = await renderApp('/child/home');

    expect(router.url).toBe('/child');
    expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
  });

  it('signs the child out with 退出 and opens the child login', async () => {
    const { router } = await renderChildHome();
    const logouts = recordCalls(
      'post',
      '/api/child-auth/logout',
      () => new HttpResponse(null, { status: 204 }),
    );
    stubRemembered();

    await userEvent.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
    expect(router.url).toBe('/child');
    expect(logouts).toEqual([null]);
  });

  it('keeps 退出 from being pressed twice, and says a server failure in a toast', async () => {
    await renderChildHome();
    const held = holdNext('post', '/api/child-auth/logout', () =>
      HttpResponse.json({}, { status: 500 }),
    );

    await userEvent.click(screen.getByRole('button', { name: '退出' }));
    await held.reached;

    await vi.waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '退出' }).disabled).toBe(true);
    });
    await held.release();
    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    await expectChildHome('小明');
  });

  it('goes to the child login when the login has ended meanwhile', async () => {
    const { router, fixture } = await renderChildHome();
    stubNoChild();
    stubRemembered();

    backToFront();
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(router.url).toBe('/child');
    });
    expect(await screen.findByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
  });

  it('says the page did not open when the child cannot be loaded, and retries', async () => {
    stubVisitor();
    stubError('get /api/child/me', 500, 'internal');
    await renderApp('/child/home');

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();

    stubChildSignedIn();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    await expectChildHome('小明');
  });
});
