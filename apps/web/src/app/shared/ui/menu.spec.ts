import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { Menu, MenuDivider, MenuItem } from './menu';

@Component({
  imports: [Menu, MenuDivider, MenuItem],
  template: `
    <div class="p-10">
      <button #trigger type="button" aria-haspopup="menu" (click)="open.set(true)">林建国</button>
    </div>
    <app-menu
      [open]="open()"
      label="林建国的操作"
      [origin]="trigger"
      [dropDown]="dropDown"
      (dismissed)="open.set(false)"
    >
      <button type="button" appMenuItem (click)="chosen = '设为管理员'; open.set(false)">
        设为管理员
      </button>
      <div appMenuDivider></div>
      <button type="button" appMenuItem [current]="true">移出家庭</button>
    </app-menu>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly open = signal(false);
  dropDown = true;
  chosen = '';
}

async function openMenu(dropDown = true) {
  const view = await render(Host, { componentProperties: { dropDown } });
  const trigger = screen.getByRole('button', { name: '林建国' });
  await userEvent.click(trigger);
  const menu = await screen.findByRole('menu', { name: '林建国的操作' });
  settleAnimations();
  return { ...view, trigger, menu };
}

async function closed(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryByRole('menu')).toBeNull();
  });
}

describe('Menu', () => {
  it('drops down 4 px below its button, focused on the first entry', async () => {
    const { trigger, menu } = await openMenu();

    expect(menu.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom).toBe(4);
    expect(menu.getBoundingClientRect().left).toBe(trigger.getBoundingClientRect().left);
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent?.trim()).toBe('设为管理员');
    });
    expect(within(menu).getByRole('separator')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '移出家庭' }).classList).toContain('bg-tint');
    await expectNoAxeViolations();
  });

  it('moves with the arrow keys, Home and End and closes with Tab', async () => {
    const { trigger } = await openMenu();
    const [first, second] = screen.getAllByRole('menuitem');
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(first);
    });

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{Tab}');

    await closed();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes with a click outside', async () => {
    await openMenu();

    await userEvent.click(document.body, { position: { x: 700, y: 600 } });

    await closed();
  });

  it('runs the entry chosen', async () => {
    const { fixture } = await openMenu();

    await userEvent.click(screen.getByRole('menuitem', { name: '设为管理员' }));

    await closed();
    expect(fixture.componentInstance.chosen).toBe('设为管理员');
  });

  it('rises from the bottom as a sheet over a dimmed page otherwise', async () => {
    const { menu } = await openMenu(false);

    const sheet = menu.parentElement ?? menu;
    expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(window.innerHeight);
    await expectNoAxeViolations();

    const backdrop = sheet.previousElementSibling as HTMLElement;
    await userEvent.click(backdrop, { position: { x: 5, y: 5 } });
    await closed();
  });
});
