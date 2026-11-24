import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { Art, type IconArt } from './art';
import { PRESS } from './button';
import { LineIcon } from './line-icon';
import { LEAVE_DURATION } from './motion';

/** Good news stays 3 s, a problem 5 s (look.md). */
export type ToastTone = 'success' | 'error';

const STAY: Record<ToastTone, number> = { success: 3000, error: 5000 };

/** A toast slides in for 250 ms before it starts its stay. */
const ENTER_DURATION = 250;

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
  readonly icon: IconArt;
  readonly leaving: boolean;
}

/**
 * The toasts at the top of the screen. A toast slides down, stays (3 s for
 * news, 5 s for problems), then slides up and fades out; its × closes it
 * sooner. The timing is kept here rather than in one long CSS animation, so
 * reduced motion shortens only the movement and never the stay.
 */
@Injectable({ providedIn: 'root' })
export class Toaster {
  private readonly shown = signal<readonly Toast[]>([]);
  private nextId = 0;

  readonly toasts = this.shown.asReadonly();

  show(text: string, tone: ToastTone, icon: IconArt): void {
    const id = this.nextId++;
    this.shown.update((toasts) => [...toasts, { id, text, tone, icon, leaving: false }]);
    setTimeout(() => this.close(id), ENTER_DURATION + STAY[tone]);
  }

  /** Slides the toast out; it is gone 150 ms later. */
  close(id: number): void {
    const toast = this.shown().find((shown) => shown.id === id);
    if (!toast || toast.leaving) {
      return;
    }
    this.shown.update((toasts) =>
      toasts.map((shown) => (shown.id === id ? { ...shown, leaving: true } : shown)),
    );
    setTimeout(() => {
      this.shown.update((toasts) => toasts.filter((shown) => shown.id !== id));
    }, LEAVE_DURATION);
  }
}

/**
 * Where the toasts appear: 80 px from the top, at most 448 px wide and 16 px
 * from the sides. The area is a polite live region, so screen readers read
 * each toast out as it arrives.
 */
@Component({
  selector: 'app-toast-outlet',
  imports: [Art, LineIcon],
  host: {
    'aria-live': 'polite',
    class: 'pointer-events-none fixed inset-x-4 top-20 z-30 mx-auto flex max-w-md flex-col gap-2',
  },
  template: `
    @for (toast of toaster.toasts(); track toast.id) {
      <div
        class="pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-white shadow-pop"
        [class]="toast.tone === 'success' ? 'bg-primary' : 'bg-rose-ink'"
        [class.animate-toast-in]="!toast.leaving"
        [class.animate-toast-out]="toast.leaving"
      >
        <img alt="" [appArt]="toast.icon" class="size-8" />
        <span class="flex-1 text-base font-bold">{{ toast.text }}</span>
        <button
          type="button"
          aria-label="关闭"
          class="-my-1.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white {{
            press
          }}"
          (click)="toaster.close(toast.id)"
        >
          <app-line-icon name="close" />
        </button>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastOutlet {
  protected readonly toaster = inject(Toaster);
  protected readonly press = PRESS;
}
