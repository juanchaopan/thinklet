import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { emulateTouch } from '../../../testing/pointer';
import { VIEWPORTS } from '../../../testing/viewports';
import { Button } from './button';
import { Dialog } from './dialog';

@Component({
  imports: [Button, Dialog],
  template: `
    <button type="button" (click)="open.set(true)">打开</button>
    <app-dialog
      [open]="open()"
      title="登录没有成功"
      icon="wrench"
      [closable]="closable"
      (dismissed)="dismissals = dismissals + 1; open.set(false)"
    >
      <p class="mt-3">请再试一次。</p>
      @if (!closable) {
        <button type="button" appButton="secondary" appDialogAction (click)="open.set(false)">
          关闭
        </button>
        <button type="button" appButton appDialogAction>再试一次</button>
      }
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly open = signal(false);
  closable = false;
  dismissals = 0;
}

async function openDialog(closable = false) {
  const view = await render(Host, { componentProperties: { closable } });
  const opener = screen.getByRole('button', { name: '打开' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: '登录没有成功' });
  settleAnimations();
  return { ...view, opener, dialog, panel: dialog };
}

async function closed(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

describe('Dialog', () => {
  it('is a modal dialog named by its title that takes the focus', async () => {
    const { dialog } = await openDialog();

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('请再试一次。')).toBeTruthy();
    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    await expectNoAxeViolations();
  });

  it('keeps Tab inside and gives the focus back when it closes', async () => {
    const { dialog, opener } = await openDialog();
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent?.trim()).toBe('关闭');
    });

    await userEvent.tab();
    expect(document.activeElement?.textContent?.trim()).toBe('再试一次');
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await closed();
    expect(document.activeElement).toBe(opener);
  });

  it('is dismissed with Escape and with the backdrop', async () => {
    const { fixture } = await openDialog();

    await userEvent.keyboard('{Escape}');
    await closed();
    await userEvent.click(screen.getByRole('button', { name: '打开' }));
    await screen.findByRole('dialog');
    settleAnimations();
    await userEvent.click(document.body, { position: { x: 5, y: 5 } });
    await closed();

    expect(fixture.componentInstance.dismissals).toBe(2);
  });

  it('shows a × instead of actions when it only shows something', async () => {
    const { dialog } = await openDialog(true);

    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));

    await closed();
  });

  it('sits in the middle with a mouse', async () => {
    const { panel } = await openDialog();

    const box = panel.getBoundingClientRect();
    expect(box.width).toBe(384);
    expect(Math.round(box.left + box.width / 2)).toBe(VIEWPORTS.desktop.width / 2);
    expect(Math.round(box.top + box.height / 2)).toBe(VIEWPORTS.desktop.height / 2);
  });

  it('floats 12 px above the bottom and the sides of a phone', async () => {
    await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    await emulateTouch(true);
    const { panel } = await openDialog();

    const box = panel.getBoundingClientRect();
    expect(box.left).toBe(12);
    expect(VIEWPORTS.phone.width - box.right).toBe(12);
    expect(VIEWPORTS.phone.height - box.bottom).toBe(12);
    expect(getComputedStyle(panel).borderTopLeftRadius).toBe('28px');
    expect(getComputedStyle(panel).borderBottomRightRadius).toBe('28px');
  });

  it('is at most 560 px wide and 16 px above the bottom of a tablet', async () => {
    await page.viewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
    await emulateTouch(true);
    const { panel } = await openDialog();

    const box = panel.getBoundingClientRect();
    expect(box.width).toBe(560);
    expect(Math.round(box.left + box.width / 2)).toBe(VIEWPORTS.tablet.width / 2);
    expect(VIEWPORTS.tablet.height - box.bottom).toBe(16);
  });
});
