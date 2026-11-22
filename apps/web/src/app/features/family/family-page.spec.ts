import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { browserIn } from '../../../testing/families';
import {
  backToFront,
  expectToast,
  recordCalls,
  renderFamilyPage,
  stubChangedWorld,
} from '../../../testing/family-page';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import {
  ERROR_NUMBER,
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  ZIHANG,
  stubError,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { frameName, raiseStillToast, toastFrame } from '../../../testing/toasts';

const FAMILY_PATH = `/api/families/${LINYUE_FAMILY_ID}`;

/** A family that is not one of 林悦's. */
const STRANGE_FAMILY_ID = 'f0f0f0f0-0000-4000-8000-000000000000';

const RENAMED = { ...LINYUE_FAMILY, name: '林家小院' };
const IN_TORONTO = { ...LINYUE_FAMILY, timezone: 'America/Toronto' };

const nameBox = () => screen.getByRole('textbox', { name: '家庭名称' });
const pencil = (name: string) => screen.getByRole('button', { name });

/** Answers renaming or moving the family with the family as the change leaves it. */
function stubUpdate(after = RENAMED): unknown[] {
  return recordCalls('patch', FAMILY_PATH, () => {
    stubChangedWorld(
      {
        ...LINYUE,
        families: LINYUE.families.map((family) =>
          family.id === after.id ? { ...family, name: after.name } : family,
        ),
      },
      after,
    );
    return HttpResponse.json(after);
  });
}

/** Starts renaming again from the page as it is, the way the current input device does it. */
async function startRenaming(): Promise<void> {
  if (screen.queryAllByRole('textbox', { name: '家庭名称' }).length > 0) {
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryAllByRole('textbox', { name: '家庭名称' })).toHaveLength(0);
    });
  }
  await userEvent.click(pencil('改家庭名称'));
  await vi.waitFor(() => {
    expect(screen.getAllByRole('textbox', { name: '家庭名称' })).toHaveLength(1);
  });
}

/** Opens the time zone list from the field being edited and searches it for "tor". */
async function searchTimeZones(): Promise<void> {
  if (screen.queryAllByRole('dialog', { name: '选择时区' }).length > 0) {
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryAllByRole('dialog', { name: '选择时区' })).toHaveLength(0);
    });
  }
  await userEvent.click(screen.getByRole('button', { name: /^时区/ }));
  const picker = await screen.findByRole('dialog', { name: '选择时区' });
  await userEvent.type(within(picker).getByRole('combobox', { name: '搜索时区' }), 'tor');
  await within(picker).findByText('America/Toronto（UTC−05:00）');
}

describe('FamilyPage', () => {
  it('shows the family to its admin with the pencils and the actions', async () => {
    await renderFamilyPage();

    expect(document.title).toBe('家庭管理 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
    expect(screen.getByText('7KQ4MZ')).toBeTruthy();
    expect(screen.getByText('Asia/Shanghai（UTC+08:00）')).toBeTruthy();
    expect(screen.getByText('家长 · 3')).toBeTruthy();
    expect(screen.getByText('jianguo.lin@example.com')).toBeTruthy();
    expect(screen.getByText('（你）')).toBeTruthy();
    for (const name of ['改家庭名称', '改时区', '更换家庭码', '周子航的操作', '林建国的操作']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: '林悦的操作' })).toBeNull();
    expect(screen.queryByText(/^当前位置/)).toBeNull();
    expect(screen.getAllByRole('link', { name: '家庭管理' })[0]?.getAttribute('aria-current')).toBe(
      'page',
    );
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('family-admin');
  });

  it('shows a member the same family without the pencils or the actions', async () => {
    await renderFamilyPage(undefined, { me: ZIHANG, families: [LINYUE_FAMILY_FOR_ZIHANG] });

    expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制家庭码' })).toBeTruthy();
    for (const name of ['改家庭名称', '改时区', '更换家庭码', '林悦的操作', '林建国的操作']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '离开家庭' }).disabled).toBe(
      false,
    );
    expect(screen.queryAllByRole('link', { name: /^新成员/ })).toHaveLength(0);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('family-member');
  });

  it('shows no hint about where the browser is to a member', async () => {
    await renderFamilyPage(undefined, {
      me: ZIHANG,
      families: [LINYUE_FAMILY_FOR_ZIHANG],
      browserZone: 'America/Toronto',
    });

    expect(screen.queryByText(/^当前位置/)).toBeNull();
  });

  describe('renaming the family', () => {
    it('edits the name in place with a mouse, and in a sheet on a touch screen', async () => {
      await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect((nameBox() as HTMLInputElement).value).toBe('林悦的家');
      expect(document.activeElement).toBe(nameBox());
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-admin-edit-name', undefined, {
        prepare: startRenaming,
      });
    });

    it('saves the new name, which the page and the family switcher show, with 已保存', async () => {
      const bodies = stubUpdate();
      const { fixture } = await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));
      await userEvent.fill(nameBox(), '  林家小院 ');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ name: '林家小院' }]);
      await expectToast('已保存');
      expect(screen.getByRole('heading', { level: 1, name: '林家小院' })).toBeTruthy();
      expect(await screen.findByRole('button', { name: '林家小院 切换家庭' })).toBeTruthy();
    });

    it('saves in a sheet titled 改家庭名称 on a touch screen', async () => {
      await emulateTouch(true);
      const bodies = stubUpdate();
      const { fixture } = await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));
      const sheet = await screen.findByRole('dialog', { name: '改家庭名称' });
      await userEvent.fill(within(sheet).getByRole('textbox', { name: '家庭名称' }), '林家小院');
      await userEvent.click(within(sheet).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ name: '林家小院' }]);
      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it.each([
      ['an empty name', '   ', '请填家庭名称'],
      [
        'a name of 21 characters',
        '一二三四五六七八九十一二三四五六七八九十一',
        '家庭名称最多 20 个字',
      ],
    ])('will not save %s', async (_case, name, hint) => {
      const bodies = stubUpdate();
      await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));
      await userEvent.fill(nameBox(), name);
      await userEvent.click(screen.getByRole('button', { name: '保存' }));

      expect(screen.getByText(hint)).toBeTruthy();
      expect(nameBox().getAttribute('aria-invalid')).toBe('true');
      expect(bodies).toEqual([]);
    });

    it('shows the hint for a name the server rejects', async () => {
      stubError(`patch ${FAMILY_PATH}`, 400, 'invalid_request', {
        fields: [{ path: 'name', code: 'too_long' }],
      });
      const { fixture } = await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));
      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(await screen.findByText('家庭名称最多 20 个字')).toBeTruthy();
    });

    it('keeps the typed name and says so when the server fails', async () => {
      stubError(`patch ${FAMILY_PATH}`, 500, 'internal');
      const { fixture } = await renderFamilyPage();

      await userEvent.click(pencil('改家庭名称'));
      await userEvent.fill(nameBox(), '林家小院');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      await expectToast('出了点问题，请稍后再试');
      expect((nameBox() as HTMLInputElement).value).toBe('林家小院');
    });

    it('says 你已不是管理员 when the admin role went elsewhere meanwhile, and the pencils go', async () => {
      stubError(`patch ${FAMILY_PATH}`, 403, 'not_admin');
      const { fixture } = await renderFamilyPage();
      await userEvent.click(pencil('改家庭名称'));
      stubChangedWorld(
        { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
        { ...LINYUE_FAMILY, role: 'member' },
      );

      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      await expectToast('你已不是管理员');
      await vi.waitFor(() => {
        expect(screen.queryByRole('button', { name: '改时区' })).toBeNull();
      });
      expect(screen.queryByRole('textbox', { name: '家庭名称' })).toBeNull();
      expect(screen.queryByRole('button', { name: '更换家庭码' })).toBeNull();
    });

    it.each([0, 125, 250, 1500, 3325, 3400])(
      'says 已保存 with a toast that slides in and out, at %i ms',
      async (time) => {
        stubUpdate(LINYUE_FAMILY);
        const { fixture } = await renderFamilyPage();
        await userEvent.click(pencil('改家庭名称'));
        await userEvent.fill(nameBox(), '林悦的家');

        await raiseStillToast(async () => {
          await userEvent.click(screen.getByRole('button', { name: '保存' }));
          await fixture.whenStable();
        }, '已保存');

        await expectScreenshotsAtEverySize(
          `family-saved-${frameName(time)}`,
          undefined,
          toastFrame(time, 'success'),
        );
      },
    );
  });

  describe('the time zone', () => {
    it('is changed in place by picking from the list, and saved with 已保存', async () => {
      const bodies = stubUpdate(IN_TORONTO);
      const { fixture } = await renderFamilyPage();

      await userEvent.click(pencil('改时区'));

      const field = screen.getByRole('button', { name: /^时区/ });
      expect(field.textContent).toContain('Asia/Shanghai（UTC+08:00）');
      expect(document.activeElement).toBe(field);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-admin-edit-timezone');

      await searchTimeZones();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-admin-timezone-picker', undefined, {
        prepare: searchTimeZones,
      });

      await userEvent.keyboard('{Enter}');
      expect(field.textContent).toContain('America/Toronto（UTC−05:00）');
      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ timezone: 'America/Toronto' }]);
      await expectToast('已保存');
      expect(await screen.findByText('America/Toronto（UTC−05:00）')).toBeTruthy();
    });

    it('goes back to the zone as it was with 取消', async () => {
      const bodies = stubUpdate(IN_TORONTO);
      await renderFamilyPage();

      await userEvent.click(pencil('改时区'));
      await userEvent.click(screen.getByRole('button', { name: '取消' }));

      expect(screen.getByText('Asia/Shanghai（UTC+08:00）')).toBeTruthy();
      expect(bodies).toEqual([]);
    });

    it("shows the admin where the browser is when it is not the family's zone, and 改成这个 saves it", async () => {
      const bodies = stubUpdate(IN_TORONTO);
      const { fixture } = await renderFamilyPage(undefined, { browserZone: 'America/Toronto' });

      expect(screen.getByText('当前位置：America/Toronto（UTC−05:00）')).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-admin-timezone-hint');

      await userEvent.click(screen.getByRole('button', { name: '改成这个' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ timezone: 'America/Toronto' }]);
      await expectToast('已保存');
      await vi.waitFor(() => {
        expect(screen.queryByText(/^当前位置/)).toBeNull();
      });
    });

    it('compares zones by their standard names', async () => {
      await renderFamilyPage(undefined, {
        families: [{ ...LINYUE_FAMILY, timezone: 'Asia/Calcutta' }],
        browserZone: 'Asia/Kolkata',
      });

      expect(screen.getByText('Asia/Kolkata（UTC+05:30）')).toBeTruthy();
      expect(screen.queryByText(/^当前位置/)).toBeNull();
    });
  });

  it('says the family is not there for a parent who is not one of its members', async () => {
    const { router, fixture } = await renderFamilyPage(`/families/${STRANGE_FAMILY_ID}`);

    expect(screen.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '回到我的家庭' }));
    await fixture.whenStable();

    expect(router.url).toBe('/');
  });

  it('says the page did not open when the server fails, with the error number, and retries', async () => {
    stubSignedIn();
    stubError(`get ${FAMILY_PATH}`, 500, 'internal');
    const { fixture } = await renderApp(`/families/${LINYUE_FAMILY_ID}`, {
      providers: [browserIn('Asia/Shanghai')],
    });

    expect(screen.getByRole('heading', { level: 1, name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();
    worker.use(http.get(FAMILY_PATH, () => HttpResponse.json(LINYUE_FAMILY)));
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    await fixture.whenStable();

    expect(await screen.findByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
  });

  it('reads the family again when the window comes back to the front', async () => {
    await renderFamilyPage();
    worker.use(
      http.get(FAMILY_PATH, () => HttpResponse.json({ ...LINYUE_FAMILY, code: 'H8P2RW' })),
    );

    backToFront();

    expect(await screen.findByText('H8P2RW')).toBeTruthy();
  });

  it('says the family is not there once the parent has been taken out of it', async () => {
    await renderFamilyPage();
    stubError(`get ${FAMILY_PATH}`, 404, 'family_not_found');

    backToFront();

    expect(await screen.findByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
  });
});
