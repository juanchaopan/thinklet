import { screen, within } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  dialogGone,
  expectToast,
  fakeClipboard,
  fakeShareSheet,
  openDialog,
  recordCalls,
  renderFamilyPage,
  stubChangedWorld,
} from '../../../testing/family-page';
import {
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  ZIHANG,
  stubError,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { raiseStillToast, toastFrame } from '../../../testing/toasts';
import { darkRuns } from '../../shared/ui/qr-code';

const CODE_PATH = `/api/families/${LINYUE_FAMILY_ID}/code`;

/** The invitation link of 林悦的家 on the site the tests run on. */
const INVITATION_LINK = `${location.origin}/join/7KQ4MZ`;

/** The invitation 林悦 shares (rules.md, 分享家庭码). */
const INVITATION = `林悦邀请你加入「林悦的家」，在好奇星球上输入家庭码 7KQ4MZ，或者打开这个链接：${INVITATION_LINK}`;

const WITH_NEW_CODE = { ...LINYUE_FAMILY, code: 'M3NP8T' };

/**
 * Opens the family page with a clipboard and a share sheet that record what
 * they get, the sheet there or not and ending as `answer` says, and presses
 * 分享邀请.
 */
async function shareInvitation(available: boolean, answer: 'shared' | 'closed' = 'shared') {
  const clipboard = fakeClipboard();
  const sheet = fakeShareSheet(available, answer);
  const { fixture } = await renderFamilyPage(undefined, {
    providers: [clipboard.provider, sheet.provider],
  });
  await userEvent.click(screen.getByRole('button', { name: '分享邀请' }));
  await fixture.whenStable();
  return { shared: sheet.shared, copied: clipboard.copied };
}

describe('FamilyCode', () => {
  it('copies the family code and says 已复制', async () => {
    const clipboard = fakeClipboard();
    const { fixture } = await renderFamilyPage(undefined, { providers: [clipboard.provider] });
    const copy = screen.getByRole('button', { name: '复制家庭码' });

    await raiseStillToast(async () => {
      await userEvent.click(copy);
      await fixture.whenStable();
    }, '已复制');
    await userEvent.unhover(copy);

    expect(clipboard.copied).toEqual(['7KQ4MZ']);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize(
      'toast-copied-1500ms',
      undefined,
      toastFrame(1500, 'success'),
    );
  });

  it('shares the invitation through the share sheet where the browser has one', async () => {
    const { shared, copied } = await shareInvitation(true);

    expect(shared).toEqual([INVITATION]);
    expect(copied).toEqual([]);
    expect(screen.queryByText('已复制')).toBeNull();
  });

  it('copies the invitation instead where the browser has no share sheet', async () => {
    const { shared, copied } = await shareInvitation(false);

    expect(shared).toEqual([]);
    expect(copied).toEqual([INVITATION]);
    await expectToast('已复制');
  });

  it('does nothing more when the parent closes the share sheet without sharing', async () => {
    const { shared, copied } = await shareInvitation(true, 'closed');

    expect(shared).toEqual([INVITATION]);
    expect(copied).toEqual([]);
    expect(screen.queryByText('已复制')).toBeNull();
  });

  it('shows the invitation link as a QR code with the code under it', async () => {
    await renderFamilyPage();

    const dialog = await openDialog('显示二维码', '扫码加入「林悦的家」');

    const code = within(dialog).getByRole('img', { name: '邀请链接的二维码' });
    const drawn = Array.from(code.querySelectorAll('g rect'), (rect) =>
      ['x', 'y', 'width'].map((name) => Number(rect.getAttribute(name))),
    );
    expect(drawn).toEqual(darkRuns(INVITATION_LINK).runs.map(({ x, y, width }) => [x, y, width]));
    expect(dialog.textContent?.replace(/\s+/g, '')).toContain('也可以输入家庭码7KQ4MZ');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-qr');

    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await dialogGone('扫码加入「林悦的家」');
  });

  it('shows the copy, share and QR code buttons to a member, without 更换家庭码', async () => {
    await renderFamilyPage(undefined, { me: ZIHANG, families: [LINYUE_FAMILY_FOR_ZIHANG] });

    for (const name of ['复制家庭码', '分享邀请', '显示二维码']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: '更换家庭码' })).toBeNull();
  });

  it('replaces the code after confirming, shows the new one and says 已更换家庭码', async () => {
    const calls = recordCalls('post', CODE_PATH, () => HttpResponse.json(WITH_NEW_CODE));
    const { fixture } = await renderFamilyPage();

    const dialog = await openDialog('更换家庭码', '更换家庭码？');

    expect(dialog.textContent).toContain('旧码会失效，用旧码发的申请也会作废。');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-new-code');
    stubChangedWorld(LINYUE, WITH_NEW_CODE);
    await userEvent.click(within(dialog).getByRole('button', { name: '更换' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('已更换家庭码');
    await dialogGone('更换家庭码？');
    expect(screen.getByText('M3NP8T')).toBeTruthy();
    expect(screen.queryByText('7KQ4MZ')).toBeNull();
  });

  it('keeps the code when the parent does not confirm', async () => {
    const calls = recordCalls('post', CODE_PATH, () => HttpResponse.json(WITH_NEW_CODE));
    await renderFamilyPage();

    const dialog = await openDialog('更换家庭码', '更换家庭码？');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await dialogGone('更换家庭码？');

    expect(calls).toEqual([]);
    expect(screen.getByText('7KQ4MZ')).toBeTruthy();
  });

  it('says 你已不是管理员 when the role went elsewhere meanwhile, and 更换家庭码 goes', async () => {
    stubError(`post ${CODE_PATH}`, 403, 'not_admin');
    const { fixture } = await renderFamilyPage();
    const dialog = await openDialog('更换家庭码', '更换家庭码？');
    stubChangedWorld(
      { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
      { ...LINYUE_FAMILY, role: 'member' },
    );

    await userEvent.click(within(dialog).getByRole('button', { name: '更换' }));
    await fixture.whenStable();

    await expectToast('你已不是管理员');
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: '更换家庭码' })).toBeNull();
    });
    expect(screen.getByText('7KQ4MZ')).toBeTruthy();
  });
});
