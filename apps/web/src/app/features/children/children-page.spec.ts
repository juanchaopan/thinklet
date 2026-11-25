import { screen, within } from '@testing-library/angular';
import type { Child } from '@thinklet/contracts';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  ALE,
  CHILDREN,
  CHILDREN_PATH,
  DOUDOU,
  XIAOMI,
  XIAOMI_ID,
  childPath,
  childRow,
  chooseAction,
  expectXiaomiGone,
  openActions,
  renderChildrenPage,
  stubChildren,
} from '../../../testing/children';
import { holdOverlaysAt } from '../../../testing/families';
import {
  backToFront,
  dialogGone,
  expectToast,
  openDialog,
  recordCalls,
} from '../../../testing/family-page';
import { emulateTouch } from '../../../testing/pointer';
import { errorBody, stubError } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { CONSENT_TEXT } from './child-form-dialog';

/** Longer than any opening, so a menu held there is fully open. */
const OPEN = 1000;

/** The label of a child without a password. */
const NO_PASSWORD = '还没设密码';

/** What a child's row says once the time to set a password with the account has run out. */
const SETUP_OVER = '请让孩子扫登录二维码设密码，或者重设密码';

/** 小雨, just added, with 48 hours from the tests' fixed time to set a password with the account. */
const XIAOYU: Child = {
  id: '0c4d6e8f-1a2b-4c3d-9e5f-6a7b8c9d0e01',
  nickname: '小雨',
  account: 'xiaoyu',
  passwordSet: false,
  passwordSetupUntil: '2026-11-23T12:00:00Z',
};

/** Each child in the list as "<nickname> 账号 <account>". */
function listed(): string[] {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) =>
      Array.from(row.querySelectorAll('p'), (line) => line.textContent?.trim())
        .slice(0, 2)
        .join(' '),
    );
}

/** What the child's row says of the password: the label and the line under it, or nothing. */
function passwordState(nickname: string): string[] {
  const row = childRow(nickname);
  const label = row.querySelector('[appChip]')?.textContent?.trim();
  const line = row.querySelectorAll('p')[2]?.textContent?.trim();
  return [label, line].filter((text): text is string => text !== undefined);
}

/** Opens 小米's actions afresh and holds the menu fully open. */
async function showActions(): Promise<void> {
  await openActions();
  await holdOverlaysAt(OPEN);
}

/** Ticks or unticks the guardian's consent by its words, as a parent does. */
async function toggleConsent(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByText(CONSENT_TEXT));
}

describe('ChildrenPage', () => {
  it('lists the children in the order they were added, each with the QR code and the actions', async () => {
    await renderChildrenPage();

    expect(document.title).toBe('孩子 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '孩子' })).toBeTruthy();
    expect(screen.getByText('林悦的家', { selector: 'header p' })).toBeTruthy();
    expect(listed()).toEqual(['小米 账号 xiaomi', '豆豆 账号 doudou', '阿乐 账号 ale2019']);
    expect(childRow('小米').querySelector('app-avatar')?.textContent).toBe('小');
    expect(childRow('小米').querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
    expect(childRow('豆豆').querySelector('app-avatar')?.classList).toContain('bg-sun-ink');
    expect(childRow('阿乐').querySelector('app-avatar')?.classList).toContain('bg-mint-ink');
    const row = within(childRow('小米'));
    const name = row.getByText('小米', { selector: 'p' }).id;
    expect(
      row.getByRole('button', { name: '显示登录二维码' }).getAttribute('aria-describedby'),
    ).toBe(name);
    expect(row.getByRole('button', { name: '更多操作' }).getAttribute('aria-describedby')).toBe(
      name,
    );
    expect(screen.getByRole('button', { name: '添加孩子' })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('children');
  });

  it('marks the children without a password, with until when they may set one with the account in the family’s time zone', async () => {
    await renderChildrenPage();

    expect(passwordState('小米')).toEqual([]);
    expect(passwordState('豆豆')).toEqual([NO_PASSWORD, '11月25日 09:12 前可以用账号登录设密码']);
    expect(passwordState('阿乐')).toEqual([NO_PASSWORD, SETUP_OVER]);
    expect(childRow('豆豆').querySelector('[appChip]')?.classList).toContain('bg-sun');
  });

  it('says how a child sets a password who was given no time to set one with the account', async () => {
    await renderChildrenPage([{ ...ALE, passwordSetupUntil: null }]);

    expect(passwordState('阿乐')).toEqual([NO_PASSWORD, SETUP_OVER]);
  });

  it('says there are no children yet, with 添加孩子 in the card', async () => {
    await renderChildrenPage([]);

    expect(screen.getByRole('heading', { level: 2, name: '还没有孩子' })).toBeTruthy();
    expect(screen.getByText('添加孩子后，孩子就能用自己的账号登录。')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '添加孩子' })).toHaveLength(1);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('children-empty');
  });

  it("opens a child's actions from the row with a mouse, and in a sheet on a touch screen", async () => {
    await renderChildrenPage();

    const menu = await openActions();

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['改昵称和账号', '记住的设备', '重设密码', '删除']);
    expect(within(menu).getByRole('menuitem', { name: '删除' }).classList).toContain(
      'text-rose-ink',
    );
    await holdOverlaysAt(OPEN);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('children-menu', undefined, { prepare: showActions });
  });

  it('heads the sheet of actions with the child on a touch screen', async () => {
    await emulateTouch(true);
    await renderChildrenPage();

    const menu = await openActions();

    expect(within(menu).getAllByText('小米')).toHaveLength(1);
  });

  describe('adding a child', () => {
    it('asks for the nickname, the account and the consent, and no password', async () => {
      await renderChildrenPage();

      const dialog = await openDialog('添加孩子', '添加孩子');

      const nickname = within(dialog).getByRole('textbox', { name: '昵称' });
      const account = within(dialog).getByRole('textbox', { name: '账号' });
      expect(account.getAttribute('aria-describedby')).toBe(
        within(dialog).getByText('孩子登录时输入，只能用小写字母和数字').id,
      );
      const consent = within(dialog).getByRole<HTMLInputElement>('checkbox', {
        name: CONSENT_TEXT,
      });
      expect(consent.checked).toBe(false);
      expect(within(dialog).queryByLabelText('密码')).toBeNull();
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(nickname);
      });
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-add');
    });

    it('lowers capitals in the account and leaves out every other character', async () => {
      await renderChildrenPage();
      const dialog = await openDialog('添加孩子', '添加孩子');
      const account = within(dialog).getByRole<HTMLInputElement>('textbox', { name: '账号' });

      await userEvent.type(account, 'Xiao Mi_2019!');

      expect(account.value).toBe('xiaomi2019');
    });

    it('adds the child to the end of the list without a password and says so, without opening the QR code', async () => {
      const calls = recordCalls('post', CHILDREN_PATH, () =>
        HttpResponse.json(XIAOYU, { status: 201 }),
      );
      const { fixture } = await renderChildrenPage();
      const dialog = await openDialog('添加孩子', '添加孩子');

      await userEvent.type(within(dialog).getByRole('textbox', { name: '昵称' }), ' 小雨 ');
      await userEvent.type(within(dialog).getByRole('textbox', { name: '账号' }), 'XiaoYu');
      await toggleConsent(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: '添加' }));
      await fixture.whenStable();

      expect(calls).toEqual([{ nickname: '小雨', account: 'xiaoyu', consent: true }]);
      await expectToast('已添加「小雨」');
      await dialogGone('添加孩子');
      expect(listed().at(-1)).toBe('小雨 账号 xiaoyu');
      expect(passwordState('小雨')).toEqual([NO_PASSWORD, '11月23日 20:00 前可以用账号登录设密码']);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('says what is missing before sending, and that another child has the account once the server says so', async () => {
      const calls = recordCalls('post', CHILDREN_PATH, () =>
        HttpResponse.json(errorBody('account_taken'), { status: 409 }),
      );
      const { fixture } = await renderChildrenPage();
      const dialog = await openDialog('添加孩子', '添加孩子');
      const nickname = within(dialog).getByRole('textbox', { name: '昵称' });
      const add = within(dialog).getByRole('button', { name: '添加' });

      await userEvent.click(add);
      expect(within(dialog).getByText('请填昵称')).toBeTruthy();
      expect(within(dialog).getByText('请填账号')).toBeTruthy();
      expect(within(dialog).getByText('请先同意')).toBeTruthy();
      expect(calls).toEqual([]);

      await userEvent.type(nickname, '小米');
      await userEvent.type(within(dialog).getByRole('textbox', { name: '账号' }), 'xiaomi');
      await toggleConsent(dialog);
      await userEvent.click(add);
      await fixture.whenStable();
      expect(calls).toHaveLength(1);
      expect(await within(dialog).findByText('家里已经有孩子用这个账号了')).toBeTruthy();

      await userEvent.clear(nickname);
      await toggleConsent(dialog);
      await userEvent.click(add);

      expect(calls).toHaveLength(1);
      expect(within(dialog).getByText('请填昵称')).toBeTruthy();
      expect(within(dialog).getByText('家里已经有孩子用这个账号了')).toBeTruthy();
      expect(within(dialog).getByText('请先同意')).toBeTruthy();
      expect(nickname.getAttribute('aria-invalid')).toBe('true');
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-add-error');
    });

    it('says a nickname is too long', async () => {
      await renderChildrenPage();
      const dialog = await openDialog('添加孩子', '添加孩子');

      await userEvent.type(
        within(dialog).getByRole('textbox', { name: '昵称' }),
        '一二三四五六七八九十一',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: '添加' }));

      expect(within(dialog).getByText('昵称最多 10 个字')).toBeTruthy();
    });
  });

  describe('changing a child', () => {
    it('saves the new nickname and account, and says 已保存', async () => {
      const saved: Child = { ...XIAOMI, nickname: '明明', account: 'mingming' };
      const calls = recordCalls('patch', childPath(XIAOMI_ID), () => HttpResponse.json(saved));
      const { fixture } = await renderChildrenPage();

      const dialog = await chooseAction('改昵称和账号', '修改小米');
      const nickname = within(dialog).getByRole<HTMLInputElement>('textbox', { name: '昵称' });
      const account = within(dialog).getByRole<HTMLInputElement>('textbox', { name: '账号' });
      expect(nickname.value).toBe('小米');
      expect(account.value).toBe('xiaomi');
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-edit');

      await userEvent.clear(nickname);
      await userEvent.type(nickname, '明明');
      await userEvent.clear(account);
      await userEvent.type(account, 'mingming');
      await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(calls).toEqual([{ nickname: '明明', account: 'mingming' }]);
      await expectToast('已保存');
      await dialogGone('修改小米');
      expect(listed()[0]).toBe('明明 账号 mingming');
    });

    it('says under the account that another child has it', async () => {
      stubError(`patch ${childPath(XIAOMI_ID)}`, 409, 'account_taken');
      const { fixture } = await renderChildrenPage();
      const dialog = await chooseAction('改昵称和账号', '修改小米');
      const account = within(dialog).getByRole('textbox', { name: '账号' });

      await userEvent.clear(account);
      await userEvent.type(account, 'doudou');
      await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(await within(dialog).findByText('家里已经有孩子用这个账号了')).toBeTruthy();
      expect(account.getAttribute('aria-invalid')).toBe('true');
    });

    it('says the child was deleted meanwhile, closes the dialog and lists the children again', async () => {
      stubError(`patch ${childPath(XIAOMI_ID)}`, 404, 'child_not_found');
      const { fixture } = await renderChildrenPage();
      const dialog = await chooseAction('改昵称和账号', '修改小米');
      stubChildren([DOUDOU, ALE]);

      await userEvent.click(within(dialog).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      await expectXiaomiGone('修改小米');
    });
  });

  it("resets the child's password after confirming, says so, and shows the child's new time to set one", async () => {
    const calls = recordCalls(
      'post',
      childPath(XIAOMI_ID, '/password-reset'),
      () => new HttpResponse(null, { status: 204 }),
    );
    const { fixture } = await renderChildrenPage();

    const dialog = await chooseAction('重设密码', '重设小米的密码？');
    expect(dialog.textContent).toContain(
      '旧密码马上不能用，已经登录的设备会退出，记住的设备也会一起撤销。之后 48 小时内，小米用账号登录就能设新密码；也可以扫登录二维码设。',
    );
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-reset-password');
    stubChildren([
      { ...XIAOMI, passwordSet: false, passwordSetupUntil: '2026-11-23T12:00:00Z' },
      DOUDOU,
      ALE,
    ]);
    await userEvent.click(within(dialog).getByRole('button', { name: '重设' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('已重设「小米」的密码');
    await dialogGone('重设小米的密码？');
    await vi.waitFor(() => {
      expect(passwordState('小米')).toEqual([NO_PASSWORD, '11月23日 20:00 前可以用账号登录设密码']);
    });
  });

  it('deletes the child after confirming, and says so', async () => {
    const calls = recordCalls(
      'delete',
      childPath(XIAOMI_ID),
      () => new HttpResponse(null, { status: 204 }),
    );
    const { fixture } = await renderChildrenPage();

    const dialog = await chooseAction('删除', '删除小米？');
    expect(dialog.textContent).toContain(
      '小米的账号、记住的设备和分派给他的书都会删掉，不能恢复。',
    );
    const remove = within(dialog).getByRole('button', { name: '删除' });
    expect(remove.classList).toContain('bg-rose-ink');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-delete-child');
    await userEvent.click(remove);
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('已删除「小米」');
    await dialogGone('删除小米？');
    expect(listed()).toEqual(['豆豆 账号 doudou', '阿乐 账号 ale2019']);
  });

  it('says a child was deleted meanwhile when deleting it, and lists the children again', async () => {
    stubError(`delete ${childPath(XIAOMI_ID)}`, 404, 'child_not_found');
    const { fixture } = await renderChildrenPage();
    const dialog = await chooseAction('删除', '删除小米？');
    stubChildren([DOUDOU, ALE]);

    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await fixture.whenStable();

    await expectXiaomiGone('删除小米？');
  });

  it('says 出了点问题 when the server fails, and keeps the child', async () => {
    stubError(`post ${childPath(XIAOMI_ID, '/password-reset')}`, 500, 'internal');
    const { fixture } = await renderChildrenPage();
    const dialog = await chooseAction('重设密码', '重设小米的密码？');

    await userEvent.click(within(dialog).getByRole('button', { name: '重设' }));
    await fixture.whenStable();

    await expectToast('出了点问题，请稍后再试');
    expect(listed()).toHaveLength(CHILDREN.length);
    expect(passwordState('小米')).toEqual([]);
  });

  it('reads the children again when the window comes back to the front', async () => {
    const { fixture } = await renderChildrenPage();
    stubChildren([...CHILDREN, XIAOYU]);

    backToFront();
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(listed()).toHaveLength(4);
    });
  });

  it('says 找不到这个家庭 for a family the parent is not in', async () => {
    await renderChildrenPage(undefined, { families: [] });

    expect(screen.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
  });
});
