import { screen, within } from '@testing-library/angular';
import type { FamilyDetail } from '@thinklet/contracts';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  dialogGone,
  expectToast,
  openDialog,
  recordCalls,
  renderFamilyPage,
  stubChangedWorld,
} from '../../../testing/family-page';
import { holdOverlaysAt } from '../../../testing/families';
import { closeMenu } from '../../../testing/menus';
import { emulateTouch } from '../../../testing/pointer';
import {
  GRANDMA_FAMILY,
  GRANDMA_FAMILY_ID,
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  LINYUE_ID,
  ZIHANG,
  ZIHANG_ID,
  stubError,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const FAMILY_PATH = `/api/families/${LINYUE_FAMILY_ID}`;

/** Longer than any opening, so a menu held there is fully open. */
const OPEN = 1000;

/** 林悦的家 after 林悦 handed the admin role to 周子航, as 林悦 sees it. */
const ZIHANG_RUNS_IT: FamilyDetail = {
  ...LINYUE_FAMILY,
  role: 'member',
  members: LINYUE_FAMILY.members.map((member) => ({
    ...member,
    role: member.parentId === ZIHANG_ID ? 'admin' : 'member',
  })),
};

/** 林悦的家 after 周子航 was taken out of it. */
const WITHOUT_ZIHANG: FamilyDetail = {
  ...LINYUE_FAMILY,
  members: LINYUE_FAMILY.members.filter((member) => member.parentId !== ZIHANG_ID),
};

/** Opens 周子航's actions afresh, as the current input device does it, held fully open. */
async function openZihangsActions(): Promise<void> {
  await closeMenu();
  await userEvent.click(screen.getByRole('button', { name: '周子航的操作' }));
  await screen.findByRole('menu', { name: '周子航的操作' });
  await holdOverlaysAt(OPEN);
}

/** Chooses one of 周子航's actions and returns the dialog that asks to confirm it. */
async function chooseForZihang(action: string, dialog: string): Promise<HTMLElement> {
  await openZihangsActions();
  await userEvent.click(screen.getByRole('menuitem', { name: action }));
  return screen.findByRole('dialog', { name: dialog });
}

describe('FamilyMembers', () => {
  it("opens a member's actions from the row with a mouse, and in a sheet headed by the member on a touch screen", async () => {
    await renderFamilyPage();

    await openZihangsActions();

    const menu = screen.getByRole('menu', { name: '周子航的操作' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['设为管理员', '移出家庭']);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('family-admin-member-menu', undefined, {
      prepare: openZihangsActions,
    });
  });

  it('heads the sheet of actions with the member on a touch screen', async () => {
    await emulateTouch(true);
    await renderFamilyPage();

    await openZihangsActions();

    expect(within(screen.getByRole('menu')).getAllByText('周子航')).toHaveLength(1);
  });

  it('hands the admin role to a member after confirming; the parent then sees what a member sees', async () => {
    const calls = recordCalls('put', `${FAMILY_PATH}/admin`, () => {
      stubChangedWorld(
        { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
        ZIHANG_RUNS_IT,
      );
      return HttpResponse.json(ZIHANG_RUNS_IT);
    });
    const { fixture } = await renderFamilyPage();

    const dialog = await chooseForZihang('设为管理员', '让周子航当管理员？');
    expect(dialog.textContent).toContain('你将变成普通家长。');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-make-admin');
    await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    await fixture.whenStable();

    expect(calls).toEqual([{ parentId: ZIHANG_ID }]);
    await expectToast('「周子航」现在是管理员');
    await dialogGone('让周子航当管理员？');
    expect(screen.queryByRole('button', { name: '改家庭名称' })).toBeNull();
    expect(screen.queryByRole('button', { name: '林建国的操作' })).toBeNull();
    await vi.waitFor(() => {
      expect(screen.queryAllByRole('link', { name: /^新成员/ })).toHaveLength(0);
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '离开家庭' }).disabled).toBe(
      false,
    );
  });

  it('takes a member out after confirming, and says so', async () => {
    const calls = recordCalls('delete', `${FAMILY_PATH}/members/${ZIHANG_ID}`, () => {
      stubChangedWorld(LINYUE, WITHOUT_ZIHANG);
      return new HttpResponse(null, { status: 204 });
    });
    const { fixture } = await renderFamilyPage();

    const dialog = await chooseForZihang('移出家庭', '把周子航移出家庭？');
    expect(dialog.textContent).toContain('移出后，周子航就看不到这个家庭了。');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-remove-parent');
    await userEvent.click(within(dialog).getByRole('button', { name: '移出' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('已移出「周子航」');
    await vi.waitFor(() => {
      expect(screen.queryByText('周子航')).toBeNull();
    });
    expect(screen.getByText('家长 · 2')).toBeTruthy();
  });

  it('says the member is gone already when they left meanwhile, and lists the members again', async () => {
    stubError(`delete ${FAMILY_PATH}/members/${ZIHANG_ID}`, 409, 'not_a_member');
    const { fixture } = await renderFamilyPage();
    const dialog = await chooseForZihang('移出家庭', '把周子航移出家庭？');
    stubChangedWorld(LINYUE, WITHOUT_ZIHANG);

    await userEvent.click(within(dialog).getByRole('button', { name: '移出' }));
    await fixture.whenStable();

    await expectToast('这位家长已经不在家庭里了');
    await vi.waitFor(() => {
      expect(screen.getByText('家长 · 2')).toBeTruthy();
    });
  });

  it('says 你已不是管理员 when the role went elsewhere meanwhile, and the actions go', async () => {
    stubError(`put ${FAMILY_PATH}/admin`, 403, 'not_admin');
    const { fixture } = await renderFamilyPage();
    const dialog = await chooseForZihang('设为管理员', '让周子航当管理员？');
    stubChangedWorld(
      { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
      ZIHANG_RUNS_IT,
    );

    await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    await fixture.whenStable();

    await expectToast('你已不是管理员');
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: '周子航的操作' })).toBeNull();
    });
  });

  it('keeps the admin from leaving, and says why', async () => {
    await renderFamilyPage();

    const leave = screen.getByRole<HTMLButtonElement>('button', { name: '离开家庭' });

    expect(leave.disabled).toBe(true);
    expect(screen.getByText('先把管理员设给别人才能离开')).toBeTruthy();
    expect(leave.getAttribute('aria-describedby')).toBe(
      screen.getByText('先把管理员设给别人才能离开').id,
    );
  });

  it('lets a member leave after confirming, and goes to the start page with no family left', async () => {
    const calls = recordCalls('delete', `${FAMILY_PATH}/members/${ZIHANG_ID}`, () => {
      stubChangedWorld({ ...ZIHANG, families: [] }, LINYUE_FAMILY_FOR_ZIHANG);
      return new HttpResponse(null, { status: 204 });
    });
    const { fixture, router } = await renderFamilyPage(undefined, {
      me: ZIHANG,
      families: [LINYUE_FAMILY_FOR_ZIHANG],
    });

    const dialog = await openDialog('离开家庭', '离开「林悦的家」？');
    expect(dialog.textContent).toContain('离开后要重新申请才能回来。');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-leave');
    await userEvent.click(within(dialog).getByRole('button', { name: '离开' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('你已离开 林悦的家');
    await vi.waitFor(() => {
      expect(router.url).toBe('/start');
    });
  });

  it('goes on to the first family after leaving the last one, on its family page', async () => {
    recordCalls('delete', `/api/families/${GRANDMA_FAMILY_ID}/members/${LINYUE_ID}`, () => {
      stubChangedWorld({ ...LINYUE, families: LINYUE.families.slice(0, 1) }, LINYUE_FAMILY);
      return new HttpResponse(null, { status: 204 });
    });
    const { fixture, router } = await renderFamilyPage(`/families/${GRANDMA_FAMILY_ID}`, {
      families: [LINYUE_FAMILY, GRANDMA_FAMILY],
    });

    const dialog = await openDialog('离开家庭', '离开「外婆家」？');
    await userEvent.click(within(dialog).getByRole('button', { name: '离开' }));
    await fixture.whenStable();

    await expectToast('你已离开 外婆家');
    await vi.waitFor(() => {
      expect(router.url).toBe(`/families/${LINYUE_FAMILY_ID}`);
    });
    expect(await screen.findByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '林悦的家 切换家庭' })).toBeTruthy();
  });
});
