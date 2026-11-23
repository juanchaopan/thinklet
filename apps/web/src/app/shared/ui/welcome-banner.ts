import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Art } from './art';

/**
 * The rabbit teacher's welcome banner at the top of a home page (rules.md,
 * 首页 and 孩子首页): the greeting, then 我是小兔老师，今天也一起学习吧！ with
 * each line kept whole, so it never breaks in the middle of a phrase. The
 * rabbit waves from the banner's right edge, cut off at its waist by the
 * banner's bottom.
 *
 * On the parent's home page the rabbit `rises` 120 ms after the banner; the
 * child's home page has no entrance and a `large` banner, whose bigger text
 * suits children.
 */
@Component({
  selector: 'app-welcome-banner',
  imports: [Art],
  host: {
    class:
      'relative block overflow-hidden rounded-card bg-linear-to-r from-surface via-peach/60 to-tint ring-1 ring-line',
  },
  template: `
    <div class="relative z-1 py-7 pl-5 sm:py-10 sm:pl-8">
      <p
        [class]="
          large()
            ? 'text-lg font-black text-ink sm:text-2xl'
            : 'text-sm font-bold text-ink-soft sm:text-base'
        "
      >
        {{ greeting() }}
      </p>
      <h1
        class="mt-2 leading-snug font-black"
        [class]="large() ? 'text-2xl sm:text-4xl' : 'text-xl sm:text-3xl'"
      >
        <span class="whitespace-nowrap">我是小兔老师，</span><br /><span class="whitespace-nowrap"
          >今天也一起学习吧！</span
        >
      </h1>
    </div>
    <div
      aria-hidden="true"
      class="absolute right-0 -bottom-2 w-32 sm:right-8 sm:w-52 lg:right-16 lg:w-60"
      [class]="rises() ? 'animate-rabbit [animation-delay:120ms]' : ''"
    >
      <img alt="" appArt="rabbit-wave" class="w-full" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeBanner {
  readonly greeting = input.required<string>();
  readonly large = input(false);
  readonly rises = input(false);
}
