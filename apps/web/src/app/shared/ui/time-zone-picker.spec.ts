import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { noDialog } from '../../../testing/families';
import { TimeZoneField } from './time-zone-picker';

const MINUS = '−';

@Component({
  imports: [TimeZoneField],
  template: `<app-time-zone-field [(value)]="value" [error]="error()" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly value = signal<string | null>('Asia/Shanghai');
  readonly error = signal<string | null>(null);
}

async function renderField(value: string | null = 'Asia/Shanghai') {
  const view = await render(Host, { componentProperties: { value: signal(value) } });
  return { ...view, host: view.fixture.componentInstance };
}

const field = () => screen.getByRole('button', { name: /^时区/ });

async function openPicker() {
  await userEvent.click(field());
  const dialog = await screen.findByRole('dialog', { name: '选择时区' });
  settleAnimations();
  const search = within(dialog).getByRole<HTMLInputElement>('combobox', { name: '搜索时区' });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(search);
  });
  return { dialog, search, list: within(dialog).getByRole('listbox', { name: '时区' }) };
}

const highlighted = (list: HTMLElement) =>
  within(list).getByRole('option', { selected: true }).textContent?.trim();

describe('TimeZoneField', () => {
  it('shows the chosen zone with its offset under the label 时区', async () => {
    await renderField();

    expect(field().textContent?.trim()).toBe('Asia/Shanghai（UTC+08:00）');
    expect(field().getAttribute('aria-haspopup')).toBe('dialog');
    await expectNoAxeViolations();
  });

  it('is empty when no zone is chosen, and says what is wrong under it', async () => {
    const { host, fixture } = await renderField(null);

    host.error.set('请选择时区');
    await fixture.whenStable();

    expect(field().textContent?.trim()).toBe('');
    expect(screen.getByText('请选择时区').id).toBe(field().getAttribute('aria-describedby'));
    await expectNoAxeViolations();
  });

  it('opens the list with the chosen zone highlighted', async () => {
    await renderField();

    const { search, list } = await openPicker();

    expect(highlighted(list)).toBe('Asia/Shanghai（UTC+08:00）');
    expect(search.getAttribute('aria-activedescendant')).toBe(
      within(list).getByRole('option', { selected: true }).id,
    );
    await expectNoAxeViolations();
  });

  it('narrows the list as the parent types, the first one found highlighted', async () => {
    await renderField();
    const { list } = await openPicker();

    await userEvent.keyboard('tor');

    const found = within(list)
      .getAllByRole('option')
      .map((option) => option.textContent?.trim());
    expect(found).toContain(`America/Toronto（UTC${MINUS}05:00）`);
    expect(found).toContain(`America/Tortola（UTC${MINUS}04:00）`);
    expect(highlighted(list)).toBe(found[0]);
  });

  it('picks the highlighted zone with the arrow keys and Enter', async () => {
    const { host } = await renderField();
    await openPicker();

    await userEvent.keyboard('america/tor');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await noDialog();
    expect(host.value()).toBe('America/Tortola');
    expect(field().textContent?.trim()).toBe(`America/Tortola（UTC${MINUS}04:00）`);
  });

  it('picks a zone with a click', async () => {
    const { host } = await renderField(null);
    const { list } = await openPicker();

    await userEvent.keyboard('kolkata');
    await userEvent.click(within(list).getByRole('option', { name: 'Asia/Kolkata（UTC+05:30）' }));

    await noDialog();
    expect(host.value()).toBe('Asia/Kolkata');
  });

  it('keeps the zone when the list is closed with Escape, and gives the focus back', async () => {
    const { host } = await renderField();
    await openPicker();

    await userEvent.keyboard('tor{Escape}');

    await noDialog();
    expect(host.value()).toBe('Asia/Shanghai');
    expect(document.activeElement).toBe(field());
  });

  it('starts over each time it opens', async () => {
    await renderField();
    await openPicker();
    await userEvent.keyboard('tor{Escape}');
    await noDialog();

    const { search, list } = await openPicker();

    expect(search.value).toBe('');
    expect(highlighted(list)).toBe('Asia/Shanghai（UTC+08:00）');
  });
});
