import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, type Routes } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { holdAnimationsAt, settleAnimations } from '../../../testing/animations';
import { renderApp } from '../../../testing/app';
import { useFixedClock } from '../../../testing/clock';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import {
  GRANDMA_FAMILY_ID,
  LINYUE,
  LINYUE_FAMILY_ID,
  REQUEST_ID,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { VIEWPORTS } from '../../../testing/viewports';
import { PageProblem } from '../../shared/ui/page-problem';
import { requireParent } from '../guards';
import { AppShell } from './app-shell';

/** A family page that could not be shown, as the family pages show it. */
@Component({
  imports: [PageProblem],
  template: `<app-page-problem [kind]="kind" [requestId]="requestId" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProblemPage {
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly kind = this.query.get('problem') === 'server' ? 'server' : 'not-found';
  protected readonly requestId = REQUEST_ID;
}

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Blank {}

/** The signed-in frame around a blank page and a family page. */
const FRAME_ROUTES: Routes = [
  {
    path: '',
    component: AppShell,
    canActivate: [requireParent],
    children: [
      { path: '', component: Blank },
      { path: 'families/:familyId', component: ProblemPage },
      { path: 'profile', component: Blank },
    ],
  },
];

const menus = () => screen.getAllByRole('navigation', { name: '主菜单' });
const visibleMenu = () => {
  const visible = menus().filter(
    (menu) => menu.offsetParent !== null || menu.getClientRects().length,
  );
  expect(visible).toHaveLength(1);
  return visible[0];
};

describe('AppShell', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('puts the menu in a sidebar from 1024 px, with the waiting count for the admin', async () => {
    await renderApp('/', { routes: FRAME_ROUTES });

    const menu = visibleMenu();
    expect(menu.closest('aside')).not.toBeNull();
    const links = within(menu).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual(['首页', '家庭管理', '新成员2']);
    expect(links[0]?.getAttribute('href')).toBe('/');
    expect(links[1]?.getAttribute('href')).toBe(`/families/${LINYUE_FAMILY_ID}`);
    expect(links[2]?.getAttribute('href')).toBe(`/families/${LINYUE_FAMILY_ID}/new-members`);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    const profile = screen.getByRole('link', { name: '林悦 个人设置' });
    expect(profile.getAttribute('href')).toBe('/profile');
    await expectNoAxeViolations();
  });

  it('puts the menu in a tab bar at the bottom below 1024 px', async () => {
    await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    await renderApp('/', { routes: FRAME_ROUTES });

    const menu = visibleMenu();
    expect(menu.closest('aside')).toBeNull();
    expect(menu.getBoundingClientRect().bottom).toBe(VIEWPORTS.phone.height);
    expect(screen.getByRole('link', { name: '个人设置' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('shows no 新成员 to a parent who is not the admin', async () => {
    localStorage.setItem('thinklet.currentFamilyId', GRANDMA_FAMILY_ID);
    await renderApp('/', { routes: FRAME_ROUTES });

    const links = within(visibleMenu()).getAllByRole('link');
    expect(links.map((link) => link.textContent?.trim())).toEqual(['首页', '家庭管理']);
  });

  it('opens the family used last on this browser, else the one joined first', async () => {
    localStorage.setItem('thinklet.currentFamilyId', 'f0f0f0f0-0000-4000-8000-000000000000');
    await renderApp('/', { routes: FRAME_ROUTES });

    expect(screen.getAllByRole('button', { name: /林悦的家/ }).length).toBeGreaterThan(0);
  });

  it('switches families from the drop-down menu and remembers the choice', async () => {
    const { fixture } = await renderApp('/', { routes: FRAME_ROUTES });

    await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
    const menu = await screen.findByRole('menu', { name: '切换家庭' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent?.replace(/\s+/g, ''))).toEqual([
      '林悦的家管理员',
      '外婆家',
    ]);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    await expectNoAxeViolations();

    await userEvent.click(within(menu).getByRole('menuitem', { name: /外婆家/ }));
    await fixture.whenStable();

    expect(localStorage.getItem('thinklet.currentFamilyId')).toBe(GRANDMA_FAMILY_ID);
    expect(screen.getAllByRole('button', { name: /外婆家/ }).length).toBeGreaterThan(0);
    expect(within(visibleMenu()).queryByRole('link', { name: /新成员/ })).toBeNull();
    await vi.waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('opens the same page of the family switched to', async () => {
    const { fixture, router } = await renderApp(`/families/${LINYUE_FAMILY_ID}`, {
      routes: FRAME_ROUTES,
    });

    await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /外婆家/ }));
    await fixture.whenStable();

    expect(router.url).toBe(`/families/${GRANDMA_FAMILY_ID}`);
  });

  it('opens the menu with the keyboard and gives the focus back when it closes', async () => {
    await renderApp('/', { routes: FRAME_ROUTES });
    const trigger = screen.getByRole('button', { name: '林悦的家 切换家庭' });

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    });
    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('opens the family menu as a sheet from the top bar and on a touch screen', async () => {
    await emulateTouch(true);
    await renderApp('/', { routes: FRAME_ROUTES });

    await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
    const menu = await screen.findByRole('menu', { name: '切换家庭' });
    const sheet = menu.parentElement ?? menu;
    settleAnimations();

    expect(VIEWPORTS.desktop.height - sheet.getBoundingClientRect().bottom).toBe(16);
    expect(sheet.getBoundingClientRect().width).toBe(560);
    await expectNoAxeViolations();
  });

  it('shows the bare frame, without menus, to a parent without a family', async () => {
    stubSignedIn({ ...LINYUE, families: [] }, []);
    await renderApp('/profile', { routes: FRAME_ROUTES });

    expect(screen.queryAllByRole('navigation')).toHaveLength(0);
    expect(screen.getByRole('img', { name: '好奇星球' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '林悦 个人设置' })).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('shows 找不到这个家庭 in the frame, with the way back', async () => {
    await renderApp(`/families/${LINYUE_FAMILY_ID}`, { routes: FRAME_ROUTES });

    expect(screen.getByRole('heading', { name: '找不到这个家庭' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '回到我的家庭' })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('error-not-found');
  });

  it('shows 页面没能打开 in the frame, with the error id and 重试', async () => {
    await renderApp(`/families/${LINYUE_FAMILY_ID}?problem=server`, { routes: FRAME_ROUTES });

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${REQUEST_ID}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(
      within(visibleMenu()).getByRole('link', { name: '家庭管理' }).getAttribute('aria-current'),
    ).toBe('page');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('error-server');
  });

  it('says 网络断开了 when the network goes away', async () => {
    await renderApp('/', { routes: FRAME_ROUTES });

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

  it('refreshes the waiting count when another page opens', async () => {
    const { router, fixture } = await renderApp('/', { routes: FRAME_ROUTES });
    worker.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ...LINYUE,
          families: [{ ...LINYUE.families[0], pendingRequests: 3 }, LINYUE.families[1]],
        }),
      ),
    );

    await router.navigateByUrl('/profile');
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(within(visibleMenu()).getByRole('link', { name: /新成员.*3/ })).toBeTruthy();
    });
  });
});
