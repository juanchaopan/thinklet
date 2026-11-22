import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, type Routes } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { renderApp } from '../../../testing/app';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import {
  ERROR_NUMBER,
  GRANDMA_FAMILY_ID,
  LINYUE,
  LINYUE_FAMILY_ID,
  LINYUE_WITH_RESULTS,
  LINYUE_WITHOUT_FAMILY,
  REQUEST_ID,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { VIEWPORTS } from '../../../testing/viewports';
import { PageProblem } from '../../shared/ui/page-problem';
import { FamilyCreation } from '../family-creation';
import { makeFamilyCurrent, requireFamilyAdmin, requireParent } from '../guards';
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

/**
 * The signed-in frame around blank pages and the family pages, which use the
 * guards the family routes use: opening a family makes it current, and its
 * new members page is for its admin.
 */
const FRAME_ROUTES: Routes = [
  {
    path: '',
    component: AppShell,
    canActivate: [requireParent],
    children: [
      { path: '', component: Blank },
      { path: 'families/:familyId', canActivate: [makeFamilyCurrent], component: ProblemPage },
      {
        path: 'families/:familyId/new-members',
        canActivate: [makeFamilyCurrent, requireFamilyAdmin],
        component: Blank,
      },
      { path: 'join', component: Blank },
      { path: 'profile', component: Blank },
    ],
  },
];

/** A family that is not one of the parent's. */
const STRANGE_FAMILY_ID = 'f0f0f0f0-0000-4000-8000-000000000000';

/** 加入家庭 as screen readers hear it while request results wait to be seen. */
const JOIN_WITH_NEWS = /^加入家庭\s*，有新的申请结果$/;

/**
 * The avatar's button as screen readers hear it: "林悦的菜单", the name
 * standing apart from the rest, and the request results not yet seen.
 */
const AVATAR = /^林悦\s*的菜单$/;
const AVATAR_WITH_NEWS = /^林悦\s*的菜单\s*，有新的申请结果$/;

const isShown = (element: HTMLElement) => element.getClientRects().length > 0;

/** The one family menu on screen: the sidebar from 1024 px, the tab bar below. */
const visibleMenu = () => {
  const visible = screen
    .getAllByRole('navigation', { name: '主菜单', hidden: true })
    .filter(isShown);
  expect(visible).toHaveLength(1);
  return visible[0];
};

/** The parent's own group in the sidebar. */
const parentGroup = () => screen.getByRole('navigation', { name: '林悦' });

const avatarButton = () => screen.getByRole('button', { name: /^林悦\s*的菜单/ });

const linkTexts = (container: HTMLElement) =>
  within(container)
    .getAllByRole('link')
    .map((link) => link.textContent?.replace(/\s+/g, ''));

/** Opens the family menu and chooses 外婆家. */
async function switchToGrandma(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: /外婆家/ }));
}

describe('AppShell', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  describe('from 1024 px', () => {
    it("puts the family's pages and the parent's own group in the sidebar", async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      const menu = visibleMenu();
      expect(menu.closest('aside')).not.toBeNull();
      const links = within(menu).getAllByRole('link');
      expect(linkTexts(menu)).toEqual(['首页', '家庭管理', '新成员2']);
      expect(links[0]?.getAttribute('href')).toBe('/');
      expect(links[1]?.getAttribute('href')).toBe(`/families/${LINYUE_FAMILY_ID}`);
      expect(links[2]?.getAttribute('href')).toBe(`/families/${LINYUE_FAMILY_ID}/new-members`);
      expect(links[0]?.getAttribute('aria-current')).toBe('page');

      const group = parentGroup();
      expect(group.closest('aside')).not.toBeNull();
      expect(group.textContent).toContain('林悦');
      expect(linkTexts(group)).toEqual(['加入家庭', '个人设置']);
      expect(within(group).getByRole('link', { name: '加入家庭' }).getAttribute('href')).toBe(
        '/join',
      );
      expect(within(group).getByRole('link', { name: '个人设置' }).getAttribute('href')).toBe(
        '/profile',
      );
      await expectNoAxeViolations();
    });

    it('heads the group with the name, which is not a link', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      expect(within(parentGroup()).queryByRole('link', { name: /林悦/ })).toBeNull();
    });

    it('shows no avatar above the content', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      expect(screen.queryByRole('button', { name: /的菜单/ })).toBeNull();
    });

    it('marks 个人设置 and 加入家庭 as current on their pages', async () => {
      const { router, fixture } = await renderApp('/profile', { routes: FRAME_ROUTES });

      expect(
        within(parentGroup()).getByRole('link', { name: '个人设置' }).getAttribute('aria-current'),
      ).toBe('page');

      await router.navigateByUrl('/join');
      await fixture.whenStable();

      expect(
        within(parentGroup()).getByRole('link', { name: '加入家庭' }).getAttribute('aria-current'),
      ).toBe('page');
    });

    it('puts a red dot on 加入家庭 while request results wait to be seen', async () => {
      stubSignedIn(LINYUE_WITH_RESULTS);
      await renderApp('/', { routes: FRAME_ROUTES });

      const join = within(parentGroup()).getByRole('link', { name: JOIN_WITH_NEWS });
      expect(join.querySelector('[appDot]')).not.toBeNull();
      await expectNoAxeViolations();
    });

    it('shows no red dot without request results', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      expect(parentGroup().querySelector('[appDot]')).toBeNull();
    });
  });

  describe('below 1024 px', () => {
    beforeEach(async () => {
      await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    });

    it("puts the family's pages in a tab bar and the avatar in the top bar", async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      const menu = visibleMenu();
      expect(menu.closest('aside')).toBeNull();
      expect(menu.getBoundingClientRect().bottom).toBe(VIEWPORTS.phone.height);
      expect(linkTexts(menu)).toEqual(['首页', '家庭管理', '2新成员']);
      expect(screen.getByRole('button', { name: AVATAR }).closest('header')).not.toBeNull();
      expect(screen.queryByRole('navigation', { name: '林悦' })).toBeNull();
      await expectNoAxeViolations();
    });

    it('puts a red dot on the avatar while request results wait to be seen', async () => {
      stubSignedIn(LINYUE_WITH_RESULTS);
      await renderApp('/', { routes: FRAME_ROUTES });

      expect(screen.getByRole('button', { name: AVATAR_WITH_NEWS })).toBeTruthy();
      await expectNoAxeViolations();
    });

    it('opens the parent menu from the avatar as a floating sheet on a touch screen', async () => {
      stubSignedIn(LINYUE_WITH_RESULTS);
      await emulateTouch(true);
      const { router, fixture } = await renderApp('/', { routes: FRAME_ROUTES });

      await userEvent.click(avatarButton());
      const menu = await screen.findByRole('menu', { name: '林悦' });
      settleAnimations();

      const sheet = menu.parentElement ?? menu;
      expect(VIEWPORTS.phone.height - sheet.getBoundingClientRect().bottom).toBe(12);
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((item) => item.textContent?.replace(/\s+/g, ''))).toEqual([
        '加入家庭，有新的申请结果',
        '个人设置',
      ]);
      expect(items[0]?.querySelector('[appDot]')).not.toBeNull();
      await expectNoAxeViolations();

      await userEvent.click(within(menu).getByRole('menuitem', { name: '个人设置' }));
      await fixture.whenStable();

      expect(router.url).toBe('/profile');
      await vi.waitFor(() => {
        expect(screen.queryByRole('menu')).toBeNull();
      });
      expect(avatarButton().classList).toContain('bg-tint');
    });

    it('drops the parent menu down from the avatar with a mouse', async () => {
      await page.viewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
      const { router, fixture } = await renderApp('/', { routes: FRAME_ROUTES });
      const avatar = avatarButton();

      await userEvent.click(avatar);
      const menu = await screen.findByRole('menu', { name: '林悦' });
      settleAnimations();

      const button = avatar.getBoundingClientRect();
      const dropDown = menu.getBoundingClientRect();
      expect(dropDown.top - button.bottom).toBeCloseTo(4, 0);
      expect(dropDown.right).toBeCloseTo(button.right, 0);
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
      });

      await userEvent.click(within(menu).getByRole('menuitem', { name: '加入家庭' }));
      await fixture.whenStable();

      expect(router.url).toBe('/join');
    });

    it('closes the parent menu with Escape and gives the focus back to the avatar', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      await userEvent.click(avatarButton());
      await screen.findByRole('menu', { name: '林悦' });
      await userEvent.keyboard('{Escape}');

      await vi.waitFor(() => {
        expect(screen.queryByRole('menu')).toBeNull();
      });
      expect(document.activeElement).toBe(avatarButton());
    });
  });

  it('shows no 新成员 to a parent who is not the admin', async () => {
    localStorage.setItem('thinklet.currentFamilyId', GRANDMA_FAMILY_ID);
    await renderApp('/', { routes: FRAME_ROUTES });

    expect(linkTexts(visibleMenu())).toEqual(['首页', '家庭管理']);
  });

  it('opens the family used last on this browser, else the one joined first', async () => {
    localStorage.setItem('thinklet.currentFamilyId', STRANGE_FAMILY_ID);
    await renderApp('/', { routes: FRAME_ROUTES });

    expect(screen.getAllByRole('button', { name: /林悦的家/ }).length).toBeGreaterThan(0);
  });

  describe('the family menu', () => {
    it('lists the families in joining order, the current one ticked, then 创建家庭', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });

      await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
      const menu = await screen.findByRole('menu', { name: '切换家庭' });
      const items = within(menu).getAllByRole('menuitem');
      expect(items.map((item) => item.textContent?.replace(/\s+/g, ''))).toEqual([
        '林悦的家管理员',
        '外婆家',
        '创建家庭',
      ]);
      expect(items[0]?.getAttribute('aria-current')).toBe('true');
      expect(within(menu).getByRole('separator')).toBeTruthy();
      await expectNoAxeViolations();
    });

    it('asks for the create dialog with 创建家庭', async () => {
      await renderApp('/', { routes: FRAME_ROUTES });
      const creation = TestBed.inject(FamilyCreation);

      await userEvent.click(screen.getByRole('button', { name: '林悦的家 切换家庭' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: '创建家庭' }));

      expect(creation.requested()).toBe(true);
      await vi.waitFor(() => {
        expect(screen.queryByRole('menu')).toBeNull();
      });
    });

    it('switches families on the home page, stays there and remembers the choice', async () => {
      const { router, fixture } = await renderApp('/', { routes: FRAME_ROUTES });

      await switchToGrandma();
      await fixture.whenStable();

      expect(router.url).toBe('/');
      expect(localStorage.getItem('thinklet.currentFamilyId')).toBe(GRANDMA_FAMILY_ID);
      expect(screen.getAllByRole('button', { name: /外婆家/ }).length).toBeGreaterThan(0);
      expect(within(visibleMenu()).queryByRole('link', { name: /新成员/ })).toBeNull();
      await vi.waitFor(() => {
        expect(screen.queryByRole('menu')).toBeNull();
      });
    });

    it.each([
      ['the family page', `/families/${LINYUE_FAMILY_ID}`, `/families/${GRANDMA_FAMILY_ID}`],
      [
        'the new members page, to a family they do not run',
        `/families/${LINYUE_FAMILY_ID}/new-members`,
        `/families/${GRANDMA_FAMILY_ID}`,
      ],
      ['the profile', '/profile', '/profile'],
      ['the join page', '/join', '/join'],
    ])('goes from %s to the page the rules give', async (_page, from, to) => {
      const { fixture, router } = await renderApp(from, { routes: FRAME_ROUTES });

      await switchToGrandma();
      await fixture.whenStable();

      expect(router.url).toBe(to);
    });

    it('goes from the new members page to the one of a family they run', async () => {
      stubSignedIn({
        ...LINYUE,
        families: [LINYUE.families[0], { ...LINYUE.families[1], role: 'admin' }],
      });
      const { fixture, router } = await renderApp(`/families/${LINYUE_FAMILY_ID}/new-members`, {
        routes: FRAME_ROUTES,
      });

      await switchToGrandma();
      await fixture.whenStable();

      expect(router.url).toBe(`/families/${GRANDMA_FAMILY_ID}/new-members`);
    });

    it('opens with the keyboard and gives the focus back when it closes', async () => {
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

    it('opens as a sheet on a touch screen', async () => {
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
  });

  describe('opening a family from its address', () => {
    it('makes that family the current one', async () => {
      await renderApp(`/families/${GRANDMA_FAMILY_ID}`, { routes: FRAME_ROUTES });

      expect(localStorage.getItem('thinklet.currentFamilyId')).toBe(GRANDMA_FAMILY_ID);
      expect(screen.getAllByRole('button', { name: /外婆家/ }).length).toBeGreaterThan(0);
    });

    it('leaves the current family alone for a family the parent is not in', async () => {
      await renderApp(`/families/${STRANGE_FAMILY_ID}`, { routes: FRAME_ROUTES });

      expect(localStorage.getItem('thinklet.currentFamilyId')).toBeNull();
      expect(screen.getAllByRole('button', { name: /林悦的家/ }).length).toBeGreaterThan(0);
    });

    it("sends a member who is not the admin from the new members page to the family's page", async () => {
      const { router } = await renderApp(`/families/${GRANDMA_FAMILY_ID}/new-members`, {
        routes: FRAME_ROUTES,
      });

      expect(router.url).toBe(`/families/${GRANDMA_FAMILY_ID}`);
    });

    it('lets the admin open the new members page', async () => {
      const { router } = await renderApp(`/families/${LINYUE_FAMILY_ID}/new-members`, {
        routes: FRAME_ROUTES,
      });

      expect(router.url).toBe(`/families/${LINYUE_FAMILY_ID}/new-members`);
    });
  });

  describe('for a parent without a family', () => {
    beforeEach(() => {
      stubSignedIn(LINYUE_WITHOUT_FAMILY, []);
    });

    it('shows the bare frame: the full logo and the avatar with the name, no menus', async () => {
      await renderApp('/profile', { routes: FRAME_ROUTES });

      expect(screen.queryAllByRole('navigation')).toHaveLength(0);
      expect(screen.getByRole('img', { name: '好奇星球' })).toBeTruthy();
      expect(screen.getByRole('button', { name: AVATAR }).textContent).toContain('林悦');
      await expectNoAxeViolations();
    });

    it('opens the same parent menu from the avatar', async () => {
      const { router, fixture } = await renderApp('/profile', { routes: FRAME_ROUTES });

      await userEvent.click(avatarButton());
      const menu = await screen.findByRole('menu', { name: '林悦' });
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent?.trim()),
      ).toEqual(['加入家庭', '个人设置']);

      await userEvent.click(within(menu).getByRole('menuitem', { name: '加入家庭' }));
      await fixture.whenStable();

      expect(router.url).toBe('/join');
    });
  });

  it('shows 找不到这个家庭 in the frame, with the way back', async () => {
    await renderApp(`/families/${LINYUE_FAMILY_ID}`, { routes: FRAME_ROUTES });

    expect(screen.getByRole('heading', { name: '找不到这个家庭' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '回到我的家庭' })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('error-not-found');
  });

  it('shows 页面没能打开 in the frame, with the error number and 重试', async () => {
    await renderApp(`/families/${LINYUE_FAMILY_ID}?problem=server`, { routes: FRAME_ROUTES });

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(
      within(visibleMenu()).getByRole('link', { name: '家庭管理' }).getAttribute('aria-current'),
    ).toBe('page');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('error-server');
  });

  it('refreshes the waiting count and the red dot when another page opens', async () => {
    const { router, fixture } = await renderApp('/', { routes: FRAME_ROUTES });
    worker.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ...LINYUE,
          families: [{ ...LINYUE.families[0], pendingRequests: 3 }, LINYUE.families[1]],
          requestResults: 2,
        }),
      ),
    );

    await router.navigateByUrl('/profile');
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(within(visibleMenu()).getByRole('link', { name: /新成员.*3/ })).toBeTruthy();
    });
    expect(within(parentGroup()).getByRole('link', { name: JOIN_WITH_NEWS })).toBeTruthy();
  });

  it('refreshes the counts when switching families on the same page', async () => {
    const { fixture } = await renderApp('/', { routes: FRAME_ROUTES });
    worker.use(http.get('/api/me', () => HttpResponse.json(LINYUE_WITH_RESULTS)));

    await switchToGrandma();
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(within(parentGroup()).getByRole('link', { name: JOIN_WITH_NEWS })).toBeTruthy();
    });
  });
});
