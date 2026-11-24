import { screen, within } from '@testing-library/angular';
import type { MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { renderApp } from '../../../testing/app';
import { holdOverlaysAt } from '../../../testing/families';
import { renderFamilyPage } from '../../../testing/family-page';
import { closeMenu } from '../../../testing/menus';
import { worker } from '../../../testing/network';
import {
  GRANDMA_FAMILY_ID,
  LINYUE,
  LINYUE_FAMILY_ID,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { VIEWPORTS } from '../../../testing/viewports';

/** Longer than any opening, so a menu held there is fully open. */
const OPEN = 1000;

/** A family that is not one of 林悦's. */
const STRANGE_FAMILY_ID = 'f0f0f0f0-0000-4000-8000-000000000000';

/** 爷爷奶奶家, a second family 林悦 runs. */
const GRANDPARENTS_FAMILY_ID = '3b5d7f9a-1c2e-4a4b-8d6f-8091a2b3c4d5';

/**
 * 林悦 as the design's family menu draws her: admin of 林悦的家 and of
 * 爷爷奶奶家, with one request waiting in each, and a member of 外婆家.
 */
const LINYUE_IN_THREE_FAMILIES: MeResponse = {
  ...LINYUE,
  families: [
    { id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 1 },
    { id: GRANDMA_FAMILY_ID, name: '外婆家', role: 'member' },
    { id: GRANDPARENTS_FAMILY_ID, name: '爷爷奶奶家', role: 'admin', pendingRequests: 1 },
  ],
};

/** The family switcher of the current family; its name may go on with the count waiting. */
const switcher = (family = '林悦的家') =>
  screen.getByRole('button', { name: new RegExp(`^${family} 切换家庭`) });

async function openMenu(family = '林悦的家'): Promise<HTMLElement> {
  await userEvent.click(switcher(family));
  return screen.findByRole('menu', { name: '切换家庭' });
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

/** The red count on the switcher, or null when it shows none. */
const switcherCount = (family = '林悦的家') =>
  switcher(family).querySelector('[appBadge]')?.textContent?.trim() ?? null;

describe('FamilySwitcher', () => {
  beforeEach(() => {
    stubSignedIn(LINYUE_IN_THREE_FAMILIES);
  });

  it('shows the families, the current one ticked, each one the parent runs with its count, and 创建家庭', async () => {
    await renderApp('/');

    const menu = await openMenu();

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.replace(/\s+/g, '')),
    ).toEqual([
      '林悦的家管理员1，1个申请等你处理',
      '外婆家',
      '爷爷奶奶家管理员1，1个申请等你处理',
      '创建家庭',
    ]);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('menu-family', undefined, { prepare: reopenMenu });
  });

  it.each([0, 100, 300])('opens from the switcher, at %i ms', async (time) => {
    await renderApp('/');

    await expectScreenshotsAtEverySize(
      `menu-family-opening-${String(time).padStart(4, '0')}ms`,
      undefined,
      {
        prepare: async () => {
          await closeMenu();
          settleAnimations();
          await openMenu();
          await holdOverlaysAt(time);
        },
      },
    );
  });

  describe('the count on the button', () => {
    it('adds up the requests waiting in every family the parent runs', async () => {
      await renderApp('/');

      expect(switcherCount()).toBe('2');
      expect(switcher().textContent?.replace(/\s+/g, '')).toBe(
        '林悦的家切换家庭2，2个申请等你处理',
      );
    });

    it('counts the requests to the families the parent runs, whichever family is current', async () => {
      localStorage.setItem('thinklet.currentFamilyId', GRANDMA_FAMILY_ID);
      await renderApp('/');

      expect(switcherCount('外婆家')).toBe('2');
    });

    it('is on the narrow top bar too', async () => {
      await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
      await renderApp('/');

      expect(switcherCount()).toBe('2');
    });

    it('is not shown while nothing waits', async () => {
      stubSignedIn();
      await renderApp('/');

      expect(switcherCount()).toBeNull();
      expect(switcher().textContent?.replace(/\s+/g, '')).toBe('林悦的家切换家庭');
    });

    it('is not shown, nor any count in the menu, to a parent who runs no family', async () => {
      stubSignedIn({
        ...LINYUE,
        families: [{ id: GRANDMA_FAMILY_ID, name: '外婆家', role: 'member' }],
      });
      await renderApp('/');

      expect(switcherCount('外婆家')).toBeNull();
      const menu = await openMenu('外婆家');
      expect(menu.querySelector('[appBadge]')).toBeNull();
    });

    it('reads 99+ past 99, and pops when the count changes', async () => {
      const { router, fixture } = await renderApp('/');
      expect(switcher().querySelector('[appBadge]')?.classList).not.toContain('animate-count');
      worker.use(
        http.get('/api/me', () =>
          HttpResponse.json({
            ...LINYUE_IN_THREE_FAMILIES,
            families: LINYUE_IN_THREE_FAMILIES.families.map((family) =>
              family.role === 'admin' ? { ...family, pendingRequests: 60 } : family,
            ),
          }),
        ),
      );

      await router.navigateByUrl('/profile');
      await fixture.whenStable();

      await vi.waitFor(() => {
        expect(switcherCount()).toBe('99+');
      });
      expect(switcher().querySelector('[appBadge]')?.classList).toContain('animate-count');
    });
  });

  it('opens the family page of the current family from the page of a family the parent is not in', async () => {
    const { router, fixture } = await renderFamilyPage(`/families/${STRANGE_FAMILY_ID}`);
    expect(screen.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();

    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /林悦的家/ }));
    await fixture.whenStable();

    expect(router.url).toBe(`/families/${LINYUE_FAMILY_ID}`);
    expect(await screen.findByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
  });
});
