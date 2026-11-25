import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ACCOUNT_DELETED_PARAMETER, ACCOUNT_DELETED_VALUE } from '../../core/account-deleted';
import { queryFlag } from '../../core/query-flag';
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
    <app-dialog [open]="deleted.on()" title="你的账号已删除" icon="door" (dismissed)="close()">
      <p class="mt-3 text-base text-ink-soft">你在好奇星球上的账号和数据都已删掉。</p>
      <button type="button" appButton appDialogAction (click)="close()">关闭</button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDeletedDialog {
  protected readonly deleted = queryFlag(ACCOUNT_DELETED_PARAMETER, ACCOUNT_DELETED_VALUE);

  protected close(): void {
    this.deleted.clear();
  }
}
