import { screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { useFixedClock } from '../../../testing/clock';
import { holdOverlaysAt } from '../../../testing/families';
import { LINYUE_WITH_RESULTS, stubSignedIn } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import type { ViewportName } from '../../../testing/viewports';

/** Longer than any opening, so a menu held there is fully open. */
const OPEN = 1000;

/**
 * Opens 林悦's menu from the avatar on the phone and the tablet, held fully
 * open; from 1024 px her entries stand in the sidebar instead, so the menu
 * is closed there.
 */
async function showParentMenu(size: ViewportName): Promise<void> {
  const shown = screen.queryAllByRole('menu').length > 0;
  if (size === 'desktop') {
    if (shown) {
      await userEvent.keyboard('{Escape}');
      await vi.waitFor(() => {
        expect(screen.queryAllByRole('menu')).toHaveLength(0);
      });
    }
    return;
  }
  if (!shown) {
    await userEvent.click(screen.getByRole('button', { name: /^林悦\s*的菜单/ }));
    await screen.findByRole('menu', { name: '林悦' });
    await holdOverlaysAt(OPEN);
  }
}

describe('Home', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('welcomes the parent with the rabbit teacher at 书库, the first of the family pages', async () => {
    await renderApp('/');

    expect(document.title).toBe('好奇星球');
    expect(screen.getByText('欢迎回来，林悦')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent?.replace(/\s+/g, '')).toBe(
      '我是小兔老师，今天也一起学习吧！',
    );
    expect(screen.getByRole('link', { name: '书库' }).getAttribute('aria-current')).toBe('page');
    await expectNoAxeViolations();
  });

  it("shows the parent's menu with the red dot from the avatar, and as the sidebar group from 1024 px", async () => {
    stubSignedIn(LINYUE_WITH_RESULTS);
    await renderApp('/');

    await expectScreenshotsAtEverySize('menu-user', undefined, { prepare: showParentMenu });
    expect(
      within(screen.getByRole('navigation', { name: '林悦' })).getByRole('link', {
        name: /^加入家庭\s*，有新的申请结果$/,
      }),
    ).toBeTruthy();
  });

  it('says 网络断开了 when the network goes away', async () => {
    await renderApp('/');

    // The toast's timer is set on a fake clock that never moves, so the
    // toast stays while it is captured.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.dispatchEvent(new Event('offline'));
    vi.useRealTimers();
    useFixedClock();

    expect(await screen.findByText('网络断开了，请稍后再试')).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('toast-offline-2500ms', undefined, { heldAt: 2500 });
  });
});
