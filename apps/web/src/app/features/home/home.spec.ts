import { screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { holdAnimationsAt } from '../../../testing/animations';
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

  it('welcomes the parent with the rabbit teacher and says children and books are coming', async () => {
    await renderApp('/');

    expect(document.title).toBe('好奇星球');
    expect(screen.getByText('欢迎回来，林悦')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent?.replace(/\s+/g, '')).toBe(
      '我是小兔老师，今天也一起学习吧！',
    );
    expect(screen.getByRole('heading', { level: 2, name: '孩子和书库很快就来' })).toBeTruthy();
    expect(screen.getByText('以后在这里看到这个家庭的孩子和书。')).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('home-signed-in');
  });

  it.each([0, 120, 300, 620])(
    'enters with the cards, the logo and the rabbit, at %i ms',
    async (time) => {
      await renderApp('/');

      holdAnimationsAt(time);
      await expectScreenshotsAtEverySize(
        `home-signed-in-entering-${String(time).padStart(4, '0')}ms`,
        undefined,
        { heldAnimations: true },
      );
    },
  );

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
    holdAnimationsAt(2500);
    await expectScreenshotsAtEverySize('toast-offline-2500ms', undefined, {
      heldAnimations: true,
    });
  });
});
