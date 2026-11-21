import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicLayout } from '../../core/layout/public-layout';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';

/**
 * The child login at `/child`. Children see this page, so the rabbit
 * teacher greets them; for now it tells them the way in is still coming.
 */
@Component({
  selector: 'app-child-login',
  imports: [Art, Button, Card, PublicLayout, RouterLink],
  template: `
    <app-public-layout>
      <div
        class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center"
      >
        <div aria-hidden="true" class="w-44 animate-rabbit">
          <div class="animate-bob motion-reduce:animate-none">
            <img alt="" appArt="rabbit-wave" class="w-full" />
          </div>
        </div>
        <section appCard class="w-full animate-rise [animation-delay:150ms]">
          <h1 class="text-2xl font-black">孩子登录</h1>
          <p class="mt-2 text-base text-ink-soft">马上就来，再等等小兔老师哦！</p>
          <div class="mt-6">
            <a appButton="secondary" routerLink="/" class="w-full">回到首页</a>
          </div>
        </section>
      </div>
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildLogin {}
