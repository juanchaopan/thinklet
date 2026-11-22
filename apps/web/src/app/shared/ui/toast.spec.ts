import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { FIXED_NOW } from '../../../testing/clock';
import { nextFrames } from '../../../testing/pointer';
import { ToastOutlet, Toaster } from './toast';

async function showToast(tone: 'success' | 'error') {
  await render(ToastOutlet);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: FIXED_NOW });
  TestBed.inject(Toaster).show(tone === 'success' ? '已保存' : '这个申请已经失效了', tone, 'party');
  await nextFrames();
}

/** Moves the fake clock on and lets the page render what changed. */
async function after(milliseconds: number): Promise<void> {
  vi.advanceTimersByTime(milliseconds);
  await nextFrames();
}

describe('Toaster', () => {
  it('reads toasts out from a polite live region', async () => {
    await showToast('success');

    const toast = screen.getByText('已保存');
    expect(toast.closest('[aria-live="polite"]')).not.toBeNull();
    expect(toast.parentElement?.classList).toContain('bg-primary');
    expect(toast.parentElement?.classList).toContain('animate-toast-in');
    // axe waits on timers of its own.
    vi.useRealTimers();
    await expectNoAxeViolations();
  });

  it('keeps good news for 3 s, then slides it away in 150 ms', async () => {
    await showToast('success');

    await after(3249);
    expect(screen.getByText('已保存').parentElement?.classList).toContain('animate-toast-in');
    await after(1);
    expect(screen.getByText('已保存').parentElement?.classList).toContain('animate-toast-out');
    await after(150);
    expect(screen.queryByText('已保存')).toBeNull();
  });

  it('keeps a problem for 5 s, in red', async () => {
    await showToast('error');

    expect(screen.getByText('这个申请已经失效了').parentElement?.classList).toContain(
      'bg-rose-ink',
    );
    await after(5249);
    expect(screen.getByText('这个申请已经失效了')).toBeTruthy();
    await after(151);
    expect(screen.queryByText('这个申请已经失效了')).toBeNull();
  });

  it('closes sooner with its ×', async () => {
    await showToast('error');

    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    await after(150);

    expect(screen.queryByText('这个申请已经失效了')).toBeNull();
  });
});
