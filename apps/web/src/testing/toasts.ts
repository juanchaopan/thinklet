import { TestBed } from '@angular/core/testing';
import { screen } from '@testing-library/angular';
import { Toaster, type ToastTone } from '../app/shared/ui/toast';
import { holdAnimationsAt } from './animations';
import { useFixedClock } from './clock';
import { nextFrames } from './pointer';
import type { ScreenshotOptions } from './screenshots';

// Helpers for the key frames of a toast (look.md, 动画, 提示条): it slides
// in for 250 ms, stays 3 s (good news) or 5 s (a problem), and slides out in
// 150 ms.

const ENTER = 250;
const STAY: Record<ToastTone, number> = { success: 3000, error: 5000 };
const LEAVE = 150;

/** Runs the work with the page's timers on a clock that only moves when told to. */
function withStillTimers(work: () => void): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    work();
  } finally {
    vi.useRealTimers();
    useFixedClock();
  }
}

/**
 * Does what raises a toast and waits for the toast with the text. Its
 * timers are set on a clock that never moves, so it stays on screen while
 * it is captured, however long that takes.
 */
export async function raiseStillToast(trigger: () => Promise<void>, text: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await trigger();
    await screen.findByText(text);
  } finally {
    vi.useRealTimers();
    useFixedClock();
  }
}

/**
 * The screenshot options for the page `time` milliseconds after the toast
 * raised by raiseStillToast appeared, with everything else on the page at
 * the same moment of its own animations, as the design's key frames are
 * drawn. While the toast stays, every animation on the page is held at that
 * moment. After that the toast is slid out and its leaving held at the
 * moment, the page being settled by then; once it has left, it is gone.
 */
export function toastFrame(time: number, tone: ToastTone): ScreenshotOptions {
  const leaving = ENTER + STAY[tone];
  if (time <= leaving) {
    return { heldAt: time };
  }
  return {
    prepare: async () => {
      const toaster = TestBed.inject(Toaster);
      withStillTimers(() => {
        for (const toast of toaster.toasts()) {
          toaster.close(toast.id);
        }
        if (time >= leaving + LEAVE) {
          vi.advanceTimersByTime(LEAVE);
        }
      });
      await nextFrames();
      const outlet = document.querySelector('app-toast-outlet');
      if (outlet) {
        holdAnimationsAt(time - leaving, outlet);
      }
    },
  };
}

/** The file name part of a key frame's moment, as the design names it: `0125ms`. */
export function frameName(time: number): string {
  return `${String(time).padStart(4, '0')}ms`;
}
