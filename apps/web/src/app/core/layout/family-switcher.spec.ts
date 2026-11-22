import { screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { renderApp } from '../../../testing/app';
import { holdOverlaysAt } from '../../../testing/families';
import { stubSignedIn } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

/** Longer than any opening, so a menu held there is fully open. */
const OPEN = 1000;

/**
 * Closes the menu as Escape does. The key is sent to the menu itself, since
 * a menu held at the start of its opening is out of sight and cannot be
 * clicked; and a key sent this way leaves the page in mouse mode, so the
 * menu opened next shows no keyboard focus ring.
 */
async function closeMenu(): Promise<void> {
  const menu = screen.queryByRole('menu');
  if (!menu) {
    return;
  }
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
  });
}

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
  await screen.findByRole('menu', { name: '切换家庭' });
}

/**
 * Opens the family menu afresh at the current size, fully open: it drops
 * down from the sidebar with a mouse and rises as a sheet on a touch screen,
 * which is chosen as it opens.
 */
async function reopenMenu(): Promise<void> {
  await closeMenu();
  await openMenu();
  await holdOverlaysAt(OPEN);
}

describe('FamilySwitcher', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('shows the families, the current one ticked, and 创建家庭 under them', async () => {
    await renderApp('/');

    await openMenu();

    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('menu-family', undefined, { prepare: reopenMenu });
  });

  it.each([0, 100, 300])('opens from the switcher, at %i ms', async (time) => {
    await renderApp('/');

    await expectScreenshotsAtEverySize(
      `menu-family-opening-${String(time).padStart(4, '0')}ms`,
      undefined,
      {
        heldAnimations: true,
        prepare: async () => {
          await closeMenu();
          settleAnimations();
          await openMenu();
          await holdOverlaysAt(time);
        },
      },
    );
  });
});
