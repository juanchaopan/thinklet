import { screen, within } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  ALE,
  DOUDOU,
  XIAOMI_DEVICES,
  XIAOMI_ID,
  childPath,
  chooseAction,
  expectXiaomiGone,
  renderChildrenPage,
  stubChildren,
  stubDevices,
} from '../../../testing/children';
import { dialogGone, expectToast, recordCalls } from '../../../testing/family-page';
import { stubError } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const TITLE = '小米记住的设备';

const [IPAD, ANDROID] = XIAOMI_DEVICES;

/** The address that revokes 小米's iPad. */
const IPAD_PATH = childPath(XIAOMI_ID, `/devices/${IPAD?.id ?? ''}`);

/** The text of each device row, without spaces. */
function deviceTexts(dialog: HTMLElement): string[] {
  return within(dialog)
    .queryAllByRole('listitem')
    .map((row) => (row.textContent ?? '').replace(/\s+/g, ''));
}

/** The first row's 撤销. */
function firstRevoke(dialog: HTMLElement): HTMLElement {
  const [revoke] = within(dialog).getAllByRole('button', { name: '撤销' });
  if (!revoke) {
    throw new Error('No device to revoke');
  }
  return revoke;
}

/** Opens 小米's devices and waits until they, or the words for none, are shown. */
async function showDevices(): Promise<HTMLElement> {
  const dialog = await chooseAction('记住的设备', TITLE);
  await vi.waitFor(() => {
    const shown =
      within(dialog).queryAllByRole('listitem').length +
      within(dialog).queryAllByText('还没有记住的设备').length;
    expect(shown).toBeGreaterThan(0);
  });
  return dialog;
}

describe('ChildDevicesDialog', () => {
  it('lists the devices, latest login first, with the days in the family time zone', async () => {
    stubDevices();
    await renderChildrenPage();

    const dialog = await showDevices();

    expect(deviceTexts(dialog)).toEqual([
      'iPad·Safari记住于11月18日·最近登录11月22日09:12撤销',
      'Android手机·Chrome记住于11月20日·最近登录11月21日19:40撤销',
    ]);
    expect(firstRevoke(dialog).getAttribute('aria-describedby')).toBe(
      within(dialog).getByText('iPad · Safari').id,
    );
    expect(within(dialog).getByRole('button', { name: '全部撤销' })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-devices');
  });

  it('says there are no devices yet, and how one gets there', async () => {
    stubDevices([]);
    await renderChildrenPage();

    const dialog = await showDevices();

    expect(within(dialog).getByText('还没有记住的设备')).toBeTruthy();
    expect(
      within(dialog).getByText('孩子登录时勾选「在这台设备上记住我」，这台设备就会出现在这里。'),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '全部撤销' })).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-devices-empty');
  });

  it('revokes one device without asking; its row slides out and nothing is said', async () => {
    stubDevices();
    const calls = recordCalls('delete', IPAD_PATH, () => new HttpResponse(null, { status: 204 }));
    const { fixture } = await renderChildrenPage();
    const dialog = await showDevices();

    await userEvent.click(firstRevoke(dialog));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
    await vi.waitFor(() => {
      expect(within(dialog).getAllByRole('listitem')[0]?.classList).toContain('animate-slide-away');
    });
    await vi.waitFor(() => {
      expect(deviceTexts(dialog)).toHaveLength(1);
    });
    expect(deviceTexts(dialog)[0]).toContain(ANDROID?.name.replace(/\s+/g, ''));
    expect(document.querySelector('app-toast-outlet')?.childElementCount).toBe(0);
  });

  it('revokes every device once confirmed over the devices, and says 已全部撤销', async () => {
    stubDevices();
    const calls = recordCalls(
      'delete',
      childPath(XIAOMI_ID, '/devices'),
      () => new HttpResponse(null, { status: 204 }),
    );
    const { fixture } = await renderChildrenPage();
    const devices = await showDevices();

    await userEvent.click(within(devices).getByRole('button', { name: '全部撤销' }));
    const confirm = await screen.findByRole('dialog', { name: '撤销小米的全部设备？' });
    expect(confirm.textContent).toContain('这些设备上点头像不能再直接登录，要重新输入密码。');
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-revoke-all');
    await userEvent.click(within(confirm).getByRole('button', { name: '全部撤销' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await expectToast('已全部撤销');
    await dialogGone('撤销小米的全部设备？');
    expect(within(devices).getByText('还没有记住的设备')).toBeTruthy();
  });

  it('says the child was deleted meanwhile, closes the devices and lists the children again', async () => {
    stubDevices();
    stubError(`delete ${IPAD_PATH}`, 404, 'child_not_found');
    const { fixture } = await renderChildrenPage();
    const dialog = await showDevices();
    stubChildren([DOUDOU, ALE]);

    await userEvent.click(firstRevoke(dialog));
    await fixture.whenStable();

    await expectXiaomiGone(TITLE);
  });

  it('closes when the devices cannot be read, and says so', async () => {
    stubError(`get ${childPath(XIAOMI_ID, '/devices')}`, 500, 'internal');
    const { fixture } = await renderChildrenPage();

    await chooseAction('记住的设备', TITLE);
    await fixture.whenStable();

    await expectToast('出了点问题，请稍后再试');
    await dialogGone(TITLE);
  });
});
