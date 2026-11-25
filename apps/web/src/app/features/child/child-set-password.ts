import {
  ChangeDetectionStrategy,
  Component,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ChildNeedsPassword } from '@thinklet/contracts';
import { asApiError, rejectedFields, tooManyTries } from '../../core/failures';
import { ChildForm } from './child-form';
import { GreetingCard } from './greeting-card';
import { NewPasswordFields } from './new-password-fields';

/** A child who logged in with the family code and the account and has to set a password first. */
export interface FirstPasswordLogin {
  readonly child: ChildNeedsPassword;
  readonly code: string;
  readonly account: string;
  /** Whether the login form had 在这台设备上记住我 ticked. */
  readonly remember: boolean;
}

/**
 * The card of the child login that sets the first password of a child the
 * family code and the account found (rules.md, 孩子登录页): 返回 at the top
 * left back to the form, the big avatar, 你好，<nickname>！, 先设一个密码，
 * 以后登录要用。, the password typed twice and 在这台设备上记住我 as the form
 * had it; 设好了，进入 sets it and opens the child's home page.
 *
 * A child whose time to set it with the account ran out meanwhile, or who
 * has a password by then, is turned down like a wrong login: the card hands
 * that back to the form (`refused`). A device that has tried too often
 * (rules.md, 限流) is told so above the button, with the minutes to wait.
 */
@Component({
  selector: 'app-child-set-password',
  imports: [GreetingCard, NewPasswordFields],
  host: { class: 'block w-full' },
  template: `
    <app-greeting-card
      [childId]="login().child.id"
      [nickname]="login().child.nickname"
      line="先设一个密码，以后登录要用。"
      action="设好了，进入"
      pendingAction="进入中…"
      [sending]="sending()"
      [canGoBack]="true"
      [refusal]="refusal()"
      [(remember)]="remember"
      (send)="submit($event)"
      (back)="back.emit()"
    >
      <app-new-password-fields class="mt-6" />
    </app-greeting-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildSetPassword extends ChildForm {
  readonly login = input.required<FirstPasswordLogin>();

  readonly back = output();
  readonly refused = output();

  protected override readonly remember = linkedSignal(() => this.login().remember);
  /** How many minutes a device that tried too often has to wait, said above the button. */
  protected readonly refusal = signal<string | null>(null);

  private readonly fields = viewChild.required(NewPasswordFields);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) {
      return;
    }
    this.refusal.set(null);
    const password = this.fields().checked();
    if (password === null) {
      return;
    }
    const { code, account } = this.login();
    const request = { code, account, password, remember: this.remember() };
    await this.send(() => this.entry.setFirstPassword(request));
  }

  protected explain(error: unknown): boolean {
    const field = rejectedFields(error).find((rejected) => rejected.path === 'password');
    if (field) {
      this.fields().refuse(field.code);
      return true;
    }
    if (asApiError(error).code === 'login_failed') {
      this.refused.emit();
      return true;
    }
    const message = tooManyTries(error);
    this.refusal.set(message);
    return message !== null;
  }
}
