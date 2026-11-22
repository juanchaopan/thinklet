import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { Card } from '../../shared/ui/card';

/**
 * The home page of a signed-in parent with a family (rules.md, 首页): the
 * rabbit teacher's welcome banner, then a card saying the family's children
 * and books are still to come. The cards rise one after another; the rabbit
 * waves from the banner's right edge, cut off at its waist by the banner's
 * bottom, and rises 120 ms after the banner. Each line of the greeting is
 * kept whole, so it never breaks in the middle of a phrase.
 */
@Component({
  selector: 'app-home',
  imports: [Art, Card],
  template: `
    <div class="mx-auto flex max-w-5xl stagger flex-col gap-6">
      <section
        class="relative overflow-hidden rounded-card bg-linear-to-r from-surface via-peach/60 to-tint ring-1 ring-line"
      >
        <div class="relative z-1 py-7 pl-5 sm:py-10 sm:pl-8">
          <p class="text-sm font-bold text-ink-soft sm:text-base">
            欢迎回来，{{ session.me()?.name }}
          </p>
          <h1 class="mt-2 text-xl leading-snug font-black sm:text-3xl">
            <span class="whitespace-nowrap">我是小兔老师，</span><br /><span
              class="whitespace-nowrap"
              >今天也一起学习吧！</span
            >
          </h1>
        </div>
        <div
          aria-hidden="true"
          class="absolute right-0 -bottom-2 w-32 animate-rabbit [animation-delay:120ms] sm:right-8 sm:w-52 lg:right-16 lg:w-60"
        >
          <img alt="" appArt="rabbit-wave" class="w-full" />
        </div>
      </section>
      <section appCard>
        <div class="flex items-center gap-4">
          <img alt="" appArt="seedling" class="size-12" />
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-black">孩子和书库很快就来</h2>
            <p class="mt-1 text-sm text-ink-soft">以后在这里看到这个家庭的孩子和书。</p>
          </div>
        </div>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  protected readonly session = inject(Session);
}
