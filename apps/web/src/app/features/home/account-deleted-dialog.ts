import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ACCOUNT_DELETED_PARAMETER, ACCOUNT_DELETED_VALUE } from '../../core/account-deleted';
import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';

/**
 * 你的账号已删除, over the product home the browser opens once the parent
 * has deleted their account (rules.md, 删除账号): the half-open door, what
 * happened and 关闭. Closing it takes `account` out of the address, which
 * leaves `/`.
 */
@Component({
  selector: 'app-account-deleted-dialog',
  imports: [Button, Dialog],
  template: `
    <app-dialog [open]="deleted()" title="你的账号已删除" icon="door" (dismissed)="close()">
      <p class="mt-3 text-base text-ink-soft">你在好奇星球上的账号和数据都已删掉。</p>
      <button type="button" appButton appDialogAction (click)="close()">关闭</button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDeletedDialog {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly deleted = computed(
    () => this.query().get(ACCOUNT_DELETED_PARAMETER) === ACCOUNT_DELETED_VALUE,
  );

  protected close(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ACCOUNT_DELETED_PARAMETER]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
