import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { childPasswordSchema, type ErrorCode } from '@thinklet/contracts';
import { asApiError, rejectedFields, tooManyTries } from '../../core/failures';
import { TextField } from '../../shared/ui/edit-field';
import { fieldHint } from '../../shared/ui/field-hint';
import { LOGIN_PASSWORD_HINTS, QrForm } from './child-form';
import { GreetingCard } from './greeting-card';
import { NewPasswordFields } from './new-password-fields';

/** The hint for a password the api says is wrong. */
const WRONG_PASSWORD = '密码不对';

/**
 * The QR login of a child without a password yet (rules.md, 扫码登录页): the
 * password typed twice, 6–32 characters, whenever the child was added or
 * the password reset. A first password that cannot be set says why under
 * it; a second one that differs is emptied for typing again.
 */
@Component({
  selector: 'app-set-password-form',
  imports: [GreetingCard, NewPasswordFields],
  host: { class: 'block w-full' },
  template: `
    <app-greeting-card
      [childId]="link().childId"
      [nickname]="link().nickname"
      line="先设一个密码，以后登录要用。"
      action="设好了，进入"
      pendingAction="进入中…"
      [sending]="sending()"
      [(remember)]="remember"
      (send)="submit($event)"
    >
      <app-new-password-fields class="mt-6" />
    </app-greeting-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPasswordForm extends QrForm {
  protected readonly staleCode: ErrorCode = 'password_already_set';

  private readonly fields = viewChild.required(NewPasswordFields);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) {
      return;
    }
    const password = this.fields().checked();
    if (password === null) {
      return;
    }
    const request = { password, remember: this.remember() };
    await this.send(() => this.entry.setPassword(this.token(), request));
  }

  protected explain(error: unknown): boolean {
    const field = rejectedFields(error).find((rejected) => rejected.path === 'password');
    if (!field) {
      return this.leftToPage(error);
    }
    this.fields().refuse(field.code);
    return true;
  }
}

/**
 * The QR login of a child who has a password (rules.md, 扫码登录页). A wrong
 * password says so and empties the box; the link can still be used. A
 * device that has tried too often (rules.md, 限流) is told so under the box
 * the same way, with the minutes to wait.
 */
@Component({
  selector: 'app-password-form',
  imports: [GreetingCard, TextField],
  host: { class: 'block w-full' },
  template: `
    <app-greeting-card
      [childId]="link().childId"
      [nickname]="link().nickname"
      line="输入你的密码。"
      action="登录"
      pendingAction="登录中…"
      [sending]="sending()"
      [(remember)]="remember"
      (send)="submit($event)"
    >
      <div class="mt-6">
        <span aria-hidden="true" class="block text-base font-bold">密码</span>
        <app-text-field
          class="mt-2 block"
          label="密码"
          [value]="password()"
          (valueChange)="editPassword($event)"
          [error]="passwordError()"
          [attempt]="attempt()"
          [large]="true"
          [password]="true"
          autocomplete="current-password"
        />
      </div>
    </app-greeting-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordForm extends QrForm {
  protected readonly staleCode: ErrorCode = 'password_not_set';

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) {
      return;
    }
    const password = this.password();
    this.passwordError.set(fieldHint(childPasswordSchema, LOGIN_PASSWORD_HINTS, password));
    if (this.passwordError()) {
      this.shake();
      return;
    }
    const request = { password, remember: this.remember() };
    await this.send(() => this.entry.loginByLink(this.token(), request));
  }

  protected explain(error: unknown): boolean {
    const message =
      asApiError(error).code === 'wrong_password' ? WRONG_PASSWORD : tooManyTries(error);
    if (message === null) {
      return this.leftToPage(error);
    }
    this.password.set('');
    this.passwordError.set(message);
    this.shake();
    return true;
  }
}
