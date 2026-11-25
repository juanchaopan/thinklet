import { screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

describe('AccountDeletedDialog', () => {
  beforeEach(() => {
    stubVisitor();
  });

  it('covers the product home after the account is deleted and goes with 关闭', async () => {
    const { fixture, router } = await renderApp('/?account=deleted');

    const dialog = await screen.findByRole('dialog', { name: '你的账号已删除' });
    expect(dialog.textContent).toContain('你在好奇星球上的账号和数据都已删掉。');
    expect(screen.getByRole('heading', { level: 1, name: /把难懂的课/ })).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('home-account-deleted');

    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.url).toBe('/');
  });

  it('is not there on the product home without the address saying so', async () => {
    await renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: /把难懂的课/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
