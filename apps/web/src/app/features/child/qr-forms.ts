import { ChangeDetectionStrategy, Component, input, model, output, signal } from '@angular/core';
import {
  childPasswordSchema,
  newChildPasswordSchema,
  type ChildLoginLinkInfo,
  type ErrorCode,
} from '@thinklet/contracts';
import { asApiError, rejectedFields } from '../../core/failures';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Checkbox } from '../../shared/ui/checkbox';
import { TextField } from '../../shared/ui/edit-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';
import { LOGIN_PASSWORD_HINTS, QrForm } from './child-form';

/** The hints for a new password that cannot be set (rules.md, 孩子). */
const NEW_PASSWORD_HINTS: FieldHints = {
  required: '请设密码',
  too_short: '密码至少 6 个字符',
  too_long: '密码最多 32 个字符',
  invalid: '请设密码',
};

/** The hint for a second password that differs from the first. */
const MISMATCH = '两次输的密码不一样';

/** The hint for a password the api says is wrong. */
const WRONG_PASSWORD = '密码不对';

/**
 * The card of the QR login page: the child greeted by name under the big
 * avatar, a line saying what to do, then the form: the password fields given
 * as content, 在这台设备上记住我 and the button that signs in, named `action`
 * and `pendingAction` while `sending`. Submitting the form emits `send`.
 */
@Component({
  selector: 'app-qr-card',
  imports: [Avatar, Button, Card, Checkbox],
  host: { class: 'block w-full' },
  template: `
    <section appCard class="relative w-full animate-rise [animation-delay:150ms]">
      <div class="flex flex-col items-center text-center">
        <app-avatar [name]="link().nickname" [personId]="link().childId" size="greeting" />
        <h1 class="mt-4 text-2xl font-black">你好，{{ link().nickname }}！</h1>
        <p class="mt-1 text-lg text-ink-soft">{{ line() }}</p>
      </div>
      <form novalidate (submit)="send.emit($event)">
        <ng-content />
        <app-checkbox class="mt-3" [large]="true" [(checked)]="remember"
          >在这台设备上记住我</app-checkbox
        >
        <button
          type="submit"
          appButton
          class="mt-5 min-h-14! w-full text-lg!"
          [disabled]="sending()"
        >
          {{ sending() ? pendingAction() : action() }}
        </button>
      </form>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrCard {
  readonly link = input.required<ChildLoginLinkInfo>();
  readonly line = input.required<string>();
  readonly action = input.required<string>();
  readonly pendingAction = input.required<string>();
  readonly sending = input(false);
  readonly remember = model(true);

  readonly send = output<Event>();
}

/**
 * The QR login of a child without a password yet (rules.md, 扫码登录页): the
 * password typed twice, 6–32 characters. A first password that cannot be set
 * says why under it; a second one that differs is emptied for typing again.
 */
@Component({
  selector: 'app-set-password-form',
  imports: [QrCard, TextField],
  host: { class: 'block w-full' },
  template: `
    <app-qr-card
      [link]="link()"
      line="先设一个密码，以后登录要用。"
      action="设好了，进入"
      pendingAction="进入中…"
      [sending]="sending()"
      [(remember)]="remember"
      (send)="submit($event)"
    >
      <div class="mt-6 flex flex-col gap-5">
        <div>
          <span aria-hidden="true" class="block text-base font-bold">密码</span>
          <app-text-field
            class="mt-2 block"
            label="密码"
            [value]="password()"
            (valueChange)="editPassword($event)"
            [error]="passwordError()"
            hint="6–32 个字符"
            [attempt]="attempt()"
            [large]="true"
            [password]="true"
            autocomplete="new-password"
          />
        </div>
        <div>
          <span aria-hidden="true" class="block text-base font-bold">再输一遍</span>
          <app-text-field
            class="mt-2 block"
            label="再输一遍"
            [value]="repeat()"
            (valueChange)="editRepeat($event)"
            [error]="repeatError()"
            [attempt]="attempt()"
            [autofocus]="false"
            [large]="true"
            [password]="true"
            autocomplete="new-password"
          />
        </div>
      </div>
    </app-qr-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetPasswordForm extends QrForm {
  protected readonly staleCode: ErrorCode = 'password_already_set';

  protected readonly repeat = signal('');
  protected readonly repeatError = signal<string | null>(null);

  protected editRepeat(repeat: string): void {
    this.repeat.set(repeat);
    this.repeatError.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending() || !this.checked()) {
      return;
    }
    const request = { password: this.password(), remember: this.remember() };
    await this.send(() => this.entry.setPassword(this.token(), request));
  }

  protected explain(error: unknown): boolean {
    const field = rejectedFields(error).find((rejected) => rejected.path === 'password');
    if (!field) {
      return this.leftToPage(error);
    }
    this.passwordError.set(NEW_PASSWORD_HINTS[field.code]);
    this.shake();
    return true;
  }

  /** Checks both passwords before sending; a second one that differs is emptied. */
  private checked(): boolean {
    const password = this.password();
    this.passwordError.set(fieldHint(newChildPasswordSchema, NEW_PASSWORD_HINTS, password));
    const differs = this.passwordError() === null && this.repeat() !== password;
    this.repeatError.set(differs ? MISMATCH : null);
    if (differs) {
      this.repeat.set('');
    }
    if (this.passwordError() || this.repeatError()) {
      this.shake();
      return false;
    }
    return true;
  }
}

/**
 * The QR login of a child who has a password (rules.md, 扫码登录页). A wrong
 * password says so and empties the box; the link can still be used.
 */
@Component({
  selector: 'app-password-form',
  imports: [QrCard, TextField],
  host: { class: 'block w-full' },
  template: `
    <app-qr-card
      [link]="link()"
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
    </app-qr-card>
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
    if (asApiError(error).code !== 'wrong_password') {
      return this.leftToPage(error);
    }
    this.password.set('');
    this.passwordError.set(WRONG_PASSWORD);
    this.shake();
    return true;
  }
}
