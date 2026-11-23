import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Child, ChildLoginLink } from '@thinklet/contracts';
import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';
import { QrCode } from '../../shared/ui/qr-code';
import { ChildrenStore } from './children-store';

/** How often the link is checked while the dialog is open and the page is in front. */
export const CHECK_INTERVAL = 3000;

/** The longest the link is checked for: as long as a link is valid (rules.md, 登录二维码). */
export const CHECK_LIMIT = 10 * 60 * 1000;

/** How often the time left is counted down. */
const TICK = 1000;

/** Where the dialog is: making the link, showing it, the link no longer valid, or the child signed in. */
type QrState = 'making' | 'live' | 'invalid' | 'used';

/** The time left until `expiresAt` at `now`, as minutes and seconds: "9:41". */
export function timeLeft(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The dialog that lets a child scan in (rules.md, 登录二维码): 让<昵称>扫码登录,
 * the QR code of a new login link made each time the dialog opens, 10 分钟内
 * 有效，还剩 <time left> counting down, and 用手机或平板的相机扫一扫. While the
 * link is being made its place is kept empty.
 *
 * While the dialog is open and the page is in front, the link is checked
 * every 3 s, for at most 10 minutes, and once more the moment its time is
 * up. Once the child has signed in with it, a large check mark and
 * <昵称>已登录 take its place, with 完成 to close; once it has run out, been
 * revoked (by a newer link, say) or the child has been deleted, the QR code
 * fades under 已失效 and 重新生成 makes a new link. The check mark replaces
 * the code without an animation.
 *
 * A link that cannot be made is said in a toast and the dialog closes.
 */
@Component({
  selector: 'app-child-qr-dialog',
  imports: [Button, Dialog, QrCode],
  template: `
    <app-dialog
      [open]="open()"
      [title]="'让' + child().nickname + '扫码登录'"
      [closable]="state() !== 'used'"
      (dismissed)="closed.emit()"
    >
      @switch (state()) {
        @case ('used') {
          <div class="mt-6 flex flex-col items-center gap-4 text-center">
            <span
              aria-hidden="true"
              class="flex size-28 items-center justify-center rounded-full bg-mint text-mint-ink"
            >
              <svg class="size-14" viewBox="0 0 20 20">
                <path
                  d="m5 10.5 3.2 3L15 7"
                  stroke="currentColor"
                  stroke-width="2.2"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <p class="text-xl font-black">{{ child().nickname }}已登录</p>
            <button type="button" appButton class="mt-2 w-full" (click)="closed.emit()">
              完成
            </button>
          </div>
        }
        @case ('invalid') {
          <div class="mt-5 flex flex-col items-center text-center">
            <div class="relative rounded-card border border-line p-2">
              @if (link(); as link) {
                <div aria-hidden="true" class="opacity-15 grayscale">
                  <app-qr-code [text]="link.url" label="" />
                </div>
              }
              <span class="absolute inset-0 flex items-center justify-center">
                <span
                  class="rounded-full bg-surface px-5 py-2 text-lg font-black text-ink shadow-pop ring-1 ring-line-strong"
                  >已失效</span
                >
              </span>
            </div>
            <button type="button" appButton class="mt-5 w-full" (click)="makeLink()">
              重新生成
            </button>
          </div>
        }
        @default {
          <div class="mt-5 flex flex-col items-center gap-1 text-center">
            <div class="rounded-card border border-line p-2">
              @if (link(); as link) {
                <app-qr-code [text]="link.url" [label]="child().nickname + '的登录二维码'" />
              } @else {
                <div class="size-67.5"></div>
              }
            </div>
            <p class="mt-3 text-base font-bold" [class.invisible]="!link()">
              10 分钟内有效，还剩 <span class="tabular-nums">{{ left() }}</span>
            </p>
            <p class="text-sm text-ink-soft">用手机或平板的相机扫一扫</p>
          </div>
        }
      }
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildQrDialog {
  readonly open = input.required<boolean>();
  readonly child = input.required<Child>();

  readonly closed = output();

  private readonly store = inject(ChildrenStore);
  private readonly document = inject(DOCUMENT);

  protected readonly link = signal<ChildLoginLink | null>(null);
  protected readonly state = signal<QrState>('making');
  private readonly now = signal(Date.now());

  protected readonly left = computed(() => {
    const link = this.link();
    return link ? timeLeft(link.expiresAt, this.now()) : '';
  });

  /** The timers of the link shown now; cleared when it stops being watched. */
  private timers: Array<ReturnType<typeof setInterval>> = [];
  /** Counts the links made and the stops, so answers about a link no longer watched are dropped. */
  private generation = 0;

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => void this.makeLink());
      } else {
        untracked(() => {
          this.stop();
        });
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.stop();
    });
  }

  /** Makes a new link, which revokes the child's links not used yet, and starts watching it. */
  protected async makeLink(): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.link.set(null);
    this.state.set('making');
    const made = await this.store.createLink(this.child());
    if (generation !== this.generation) {
      return;
    }
    if (typeof made === 'string') {
      this.closed.emit();
      return;
    }
    this.link.set(made);
    this.now.set(Date.now());
    this.state.set('live');
    this.watch(made, generation);
  }

  /**
   * Counts the time left down every second, checking the link once when its
   * time is up, and checks it every 3 s while the page is in front, for at
   * most 10 minutes.
   */
  private watch(link: ChildLoginLink, generation: number): void {
    const started = Date.now();
    const expires = Date.parse(link.expiresAt);
    let checkedAtEnd = false;
    this.timers = [
      setInterval(() => {
        this.now.set(Date.now());
        if (!checkedAtEnd && expires <= this.now()) {
          checkedAtEnd = true;
          void this.check(link, generation);
        }
      }, TICK),
      setInterval(() => {
        if (Date.now() - started > CHECK_LIMIT) {
          this.stop();
        } else if (this.document.visibilityState === 'visible') {
          void this.check(link, generation);
        }
      }, CHECK_INTERVAL),
    ];
  }

  /** Shows what the check of the link found, while that link is still the one watched. */
  private async check(link: ChildLoginLink, generation: number): Promise<void> {
    const found = await this.store.checkLink(this.child(), link);
    if (generation !== this.generation) {
      return;
    }
    if (found === 'used') {
      this.state.set('used');
      this.stop();
    } else if (found === 'expired' || found === 'revoked' || found === 'invalid') {
      this.state.set('invalid');
      this.stop();
    }
  }

  /** Stops counting and checking; answers still on their way are dropped. */
  private stop(): void {
    this.generation++;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }
}
