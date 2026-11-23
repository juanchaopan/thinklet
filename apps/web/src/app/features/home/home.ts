import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { Card } from '../../shared/ui/card';
import { WelcomeBanner } from '../../shared/ui/welcome-banner';

/**
 * The home page of a signed-in parent with a family (rules.md, 首页): the
 * rabbit teacher's welcome banner, then a card saying the book library is
 * still to come, where books will be picked and given to the children. The
 * cards rise one after another, and the rabbit rises 120 ms after the banner.
 */
@Component({
  selector: 'app-home',
  imports: [Art, Card, WelcomeBanner],
  template: `
    <div class="mx-auto flex max-w-5xl stagger flex-col gap-6">
      <app-welcome-banner [greeting]="greeting()" [rises]="true" />
      <section appCard>
        <div class="flex items-center gap-4">
          <img alt="" appArt="seedling" class="size-12" />
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-black">书库很快就来</h2>
            <p class="mt-1 text-sm text-ink-soft">以后在这里挑书，分派给孩子。</p>
          </div>
        </div>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly session = inject(Session);

  protected readonly greeting = computed(() => `欢迎回来，${this.session.me()?.name ?? ''}`);
}
