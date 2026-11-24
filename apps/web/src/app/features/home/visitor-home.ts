import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicLayout } from '../../core/layout/public-layout';
import { loginUrl } from '../../core/login';
import { LoginFailedDialog } from '../../core/login-failed-dialog';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/card';

/**
 * The product home at `/` for visitors: what the product is, the parents'
 * way in (to the hosted login page, coming back to `returnTo` afterwards)
 * and the children's. The rabbit teacher rises into place, its speech bubble
 * pops up after it, and then it floats gently while the page is open.
 *
 * `?login=failed` is where a failed sign-in lands: 登录没有成功 covers the
 * page and offers another try.
 */
@Component({
  selector: 'app-visitor-home',
  imports: [Art, Button, Chip, LoginFailedDialog, PublicLayout, RouterLink],
  template: `
    <app-public-layout>
      <section
        class="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-0"
      >
        <div class="flex stagger flex-col items-center text-center lg:items-start lg:text-left">
          <div><span appChip="violet">给 3–18 岁的孩子</span></div>
          <h1 class="mt-5 text-4xl leading-tight font-black tracking-tight sm:text-5xl lg:text-6xl">
            把难懂的课，<br />变成好玩的题
          </h1>
          <p class="mt-5 max-w-lg text-lg leading-relaxed text-ink-soft">
            用有趣的方式带孩子学习难懂、复杂的课程，教他们解题，帮他们整理思路。
          </p>
          <div class="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a appButton [href]="loginHref()" class="sm:min-w-48">家长登录 / 注册</a>
            <a appButton="secondary" routerLink="/child" class="sm:min-w-48">孩子登录</a>
          </div>
        </div>
        <div
          aria-hidden="true"
          class="relative mx-auto flex w-full max-w-md items-end justify-center"
        >
          <div
            class="absolute inset-x-6 top-16 bottom-0 animate-fade rounded-[3rem] bg-linear-to-br from-peach via-surface to-tint ring-1 ring-line"
          ></div>
          <div class="relative z-1 w-52 animate-rabbit sm:w-64 lg:w-72">
            <div class="animate-bob motion-reduce:animate-none">
              <img alt="" appArt="rabbit" class="w-full" />
            </div>
          </div>
          <div
            class="absolute top-6 right-0 z-2 max-w-44 origin-bottom-left animate-bubble rounded-3xl rounded-bl-md bg-surface px-4 py-3 text-base font-bold text-ink shadow-pop sm:top-10 sm:right-2"
          >
            一起把难题<br />想明白吧！
          </div>
        </div>
      </section>
    </app-public-layout>

    <app-login-failed-dialog />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisitorHome {
  /** The page to come back to after signing in. */
  readonly returnTo = input<string>();

  protected readonly loginHref = computed(() => loginUrl(this.returnTo()));
}
