import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { within } from '@testing-library/angular';
import type { ChildLoginLinkStatus } from '@thinklet/contracts';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  DUODUO,
  LELE,
  XIAOMING_ID,
  XIAOMING_LINK,
  childPath,
  childRow,
  expectXiaomingGone,
  renderChildrenPage,
  stubChildren,
  stubLoginLinks,
} from '../../../testing/children';
import { FIXED_NOW, useFixedClock } from '../../../testing/clock';
import { dialogGone } from '../../../testing/family-page';
import { nextFrames } from '../../../testing/pointer';
import { stubError } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { darkRuns } from '../../shared/ui/qr-code';
import { CHECK_INTERVAL, CHECK_LIMIT, timeLeft } from './child-qr-dialog';

const TITLE = '让小明扫码登录';

/** The time 小明's link has left when it is made: 9 minutes 41 seconds. */
const LINK_TIME = (9 * 60 + 41) * 1000;

/** Presses 小明's QR button and returns the dialog once it shows the link. */
async function showQrCode(): Promise<HTMLElement> {
  await userEvent.click(within(childRow('小明')).getByRole('button', { name: '显示登录二维码' }));
  const dialog = await within(document.body).findByRole('dialog', { name: TITLE });
  await within(dialog).findByRole('img', { name: '小明的登录二维码' });
  return dialog;
}

/**
 * Runs the page's intervals and its clock on a fake clock from the tests'
 * fixed time, so a test moves time on itself; the checks' answers still come
 * back from the stubs as they do.
 */
function fakeClock(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now: FIXED_NOW });
}

/** Puts the page back on the fixed clock with real intervals, as for a screenshot. */
function realClock(): void {
  vi.useRealTimers();
  useFixedClock();
}

/** Moves the fake clock on by `time`, and waits until the checks it started have been answered and shown. */
async function wait(time: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(time);
  await TestBed.inject(ApplicationRef).whenStable();
  await nextFrames();
}

/** Keeps the page out of the front while `work` runs, as another tab in front does. */
async function whileHidden(work: () => Promise<void>): Promise<void> {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    await work();
  } finally {
    visibility.mockRestore();
  }
}

/** Stubs 小明's links: made as the design's link, and checked as `status` says. */
function answerChecks(status: ChildLoginLinkStatus | 'invalid'): { made: number; checked: number } {
  return stubLoginLinks(() => status);
}

describe('ChildQrDialog', () => {
  afterEach(() => {
    realClock();
  });

  it('shows the QR code of a new login link with the time left counting down', async () => {
    const counts = answerChecks('active');
    await renderChildrenPage();
    fakeClock();

    const dialog = await showQrCode();

    expect(counts.made).toBe(1);
    const code = within(dialog).getByRole('img', { name: '小明的登录二维码' });
    expect(code.querySelectorAll('g rect')).toHaveLength(darkRuns(XIAOMING_LINK.url).runs.length);
    expect(dialog.textContent?.replace(/\s+/g, '')).toContain('10分钟内有效，还剩9:41');
    expect(dialog.textContent).toContain('用手机或平板的相机扫一扫');
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeTruthy();
    realClock();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-qr');
  });

  it('counts the time left down every second', async () => {
    answerChecks('active');
    await renderChildrenPage();
    fakeClock();

    const dialog = await showQrCode();
    await wait(1000);

    expect(dialog.textContent?.replace(/\s+/g, '')).toContain('还剩9:40');
  });

  it('checks the link every 3 s, and shows the check mark once the child has signed in', async () => {
    let status: ChildLoginLinkStatus = 'active';
    const counts = stubLoginLinks(() => status);
    await renderChildrenPage();
    fakeClock();
    const dialog = await showQrCode();

    await wait(CHECK_INTERVAL);
    expect(counts.checked).toBe(1);
    expect(within(dialog).getByRole('img', { name: '小明的登录二维码' })).toBeTruthy();

    status = 'used';
    await wait(CHECK_INTERVAL);

    expect(within(dialog).getByText('小明已登录')).toBeTruthy();
    expect(within(dialog).queryByRole('img')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: '关闭' })).toBeNull();
    await wait(CHECK_INTERVAL * 3);
    expect(counts.checked).toBe(2);
    realClock();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-qr-done');

    within(dialog).getByRole('button', { name: '完成' }).click();
    await dialogGone(TITLE);
  });

  it.each([['expired'], ['revoked'], ['invalid']] as const)(
    'fades the QR code under 已失效 once the link is %s, and makes a new one with 重新生成',
    async (status) => {
      answerChecks(status);
      await renderChildrenPage();
      fakeClock();
      const dialog = await showQrCode();

      await wait(CHECK_INTERVAL);

      expect(within(dialog).getByText('已失效')).toBeTruthy();
      expect(within(dialog).queryByRole('img')).toBeNull();
      realClock();
      if (status === 'expired') {
        await expectNoAxeViolations();
        await expectScreenshotsAtEverySize('child-qr-expired');
      }

      const again = answerChecks('active');
      within(dialog).getByRole('button', { name: '重新生成' }).click();

      expect(await within(dialog).findByRole('img', { name: '小明的登录二维码' })).toBeTruthy();
      expect(again.made).toBe(1);
    },
  );

  it('checks the link the moment its time is up, even while the page is not in front', async () => {
    answerChecks('active');
    await renderChildrenPage();
    fakeClock();
    const dialog = await showQrCode();
    const after = answerChecks('expired');

    await whileHidden(() => wait(LINK_TIME));

    expect(after.checked).toBe(1);
    expect(within(dialog).getByText('已失效')).toBeTruthy();
  });

  it('does not check every 3 s while the page is not in front', async () => {
    const counts = answerChecks('active');
    await renderChildrenPage();
    fakeClock();
    await showQrCode();

    await whileHidden(() => wait(CHECK_INTERVAL * 2));
    expect(counts.checked).toBe(0);

    await wait(CHECK_INTERVAL);
    expect(counts.checked).toBe(1);
  });

  it('stops checking after 10 minutes', async () => {
    const counts = answerChecks('active');
    await renderChildrenPage();
    fakeClock();
    await showQrCode();

    await wait(CHECK_LIMIT + CHECK_INTERVAL);
    const checked = counts.checked;
    await wait(CHECK_INTERVAL * 5);

    expect(checked).toBeGreaterThan(0);
    expect(counts.checked).toBe(checked);
  });

  it('says the child was deleted meanwhile, closes the dialog and lists the children again', async () => {
    stubError(`post ${childPath(XIAOMING_ID, '/login-links')}`, 404, 'child_not_found');
    const { fixture } = await renderChildrenPage();
    stubChildren([DUODUO, LELE]);

    within(childRow('小明')).getByRole('button', { name: '显示登录二维码' }).click();
    await fixture.whenStable();

    await expectXiaomingGone(TITLE);
  });
});

describe('timeLeft', () => {
  it('writes the time left as minutes and seconds, never below 0:00', () => {
    const end = '2026-11-21T12:10:00.000Z';
    const at = (time: string) => Date.parse(time);

    expect(timeLeft(end, at('2026-11-21T12:00:00.000Z'))).toBe('10:00');
    expect(timeLeft(end, at('2026-11-21T12:00:19.000Z'))).toBe('9:41');
    expect(timeLeft(end, at('2026-11-21T12:09:59.500Z'))).toBe('0:01');
    expect(timeLeft(end, at('2026-11-21T12:11:00.000Z'))).toBe('0:00');
  });
});
