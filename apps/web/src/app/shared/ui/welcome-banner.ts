import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Art } from './art';

/**
 * The rabbit teacher's welcome banner at the top of the library and of the
 * child's home page (rules.md, 书库 and 孩子首页). The rabbit waves from the
 * banner's right edge, cut off at its waist by the banner's bottom.
 *
 * The child's banner is `large`: the greeting, then 我是小兔老师，今天也一起学习
 * 吧！ in big text that suits children, each line kept whole so it never
 * breaks in the middle of a phrase. The library's banner is low, so the
 * books start high on the page: the greeting as its heading and one `line`
 * of what to do there, with a smaller rabbit.
 *
 * On the library the rabbit `rises` 120 ms after the banner; the child's
 * home page has no entrance.
 */
@Component({
  selector: 'app-welcome-banner',
  imports: [Art],
  host: {
    class:
      'relative block overflow-hidden rounded-card bg-linear-to-r from-surface via-peach/60 to-tint ring-1 ring-line',
  },
  template: `
    @if (large()) {
      <div class="relative z-1 py-7 pl-5 sm:py-10 sm:pl-8">
        <p class="text-lg font-black text-ink sm:text-2xl">{{ greeting() }}</p>
        <h1 class="mt-2 text-2xl leading-snug font-black sm:text-4xl">
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
    } @else {
      <div class="relative z-1 py-5 pr-28 pl-5 sm:py-6 sm:pr-48 sm:pl-8">
        <h1 class="text-xl leading-snug font-black sm:text-2xl">{{ greeting() }}</h1>
        <p class="mt-1 text-sm text-ink-soft sm:text-base">{{ line() }}</p>
      </div>
      <div
        aria-hidden="true"
        class="absolute right-1 -bottom-5 w-24 sm:right-10 sm:-bottom-6 sm:w-32 lg:right-14"
        [class]="rises() ? 'animate-rabbit [animation-delay:120ms]' : ''"
      >
        <img alt="" appArt="rabbit-wave" class="w-full" />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WelcomeBanner {
  readonly greeting = input.required<string>();
  /** What the low banner says under the greeting. */
  readonly line = input('');
  readonly large = input(false);
  readonly rises = input(false);
}
