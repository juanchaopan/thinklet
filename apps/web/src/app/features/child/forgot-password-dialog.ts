import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from '../../shared/ui/button';
import { Dialog } from '../../shared/ui/dialog';

/** How a child who forgot the password gets a new one (rules.md, 孩子登录页). */
const FORGOT_PASSWORD_TEXT =
  '请家长在「孩子」里点「重设密码」。之后 48 小时内用账号登录，或者扫家长给的二维码，就能设一个新密码。';

/**
 * What a child who forgot the password does: the carrot key, 忘记密码了？,
 * how a parent's reset lets the child set a new one, and 知道了, which
 * closes it like Escape and the backdrop. It changes no data.
 */
@Component({
  selector: 'app-forgot-password-dialog',
  imports: [Button, Dialog],
  template: `
    <app-dialog [open]="open()" title="忘记密码了？" icon="key" (dismissed)="closed.emit()">
      <p class="mt-3 text-base text-ink-soft">{{ text }}</p>
      <button type="button" appButton appDialogAction (click)="closed.emit()">知道了</button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordDialog {
  readonly open = input.required<boolean>();

  readonly closed = output();

  protected readonly text = FORGOT_PASSWORD_TEXT;
}
