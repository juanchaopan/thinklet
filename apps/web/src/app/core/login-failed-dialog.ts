import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Button } from '../shared/ui/button';
import { Dialog } from '../shared/ui/dialog';
import { loginUrl } from './login';

/**
 * 登录没有成功, over the page `/?login=failed` lands on when coming back
 * from the hosted login page failed (rules.md, 登录和登录状态): the product
 * home for a visitor, the library for a signed-in parent. It offers another
 * try, back towards the address's `returnTo`. Closing it takes `login` out
 * of the address, which leaves `/`.
 */
@Component({
  selector: 'app-login-failed-dialog',
  imports: [Button, Dialog],
  template: `
    <app-dialog [open]="failed()" title="登录没有成功" icon="wrench" (dismissed)="close()">
      <p class="mt-3 text-base text-ink-soft">请再试一次。</p>
      <button type="button" appButton="secondary" appDialogAction (click)="close()">关闭</button>
      <a appButton appDialogAction [href]="loginHref()">再试一次</a>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginFailedDialog {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly failed = computed(() => this.query().get('login') === 'failed');
  protected readonly loginHref = computed(() => loginUrl(this.query().get('returnTo')));

  protected close(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { login: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
