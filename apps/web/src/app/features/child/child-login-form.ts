import {
  ChangeDetectionStrategy,
  Component,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { childAccountSchema, childPasswordSchema, type RememberedChild } from '@thinklet/contracts';
import { asApiError, tooManyTries } from '../../core/failures';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Checkbox } from '../../shared/ui/checkbox';
import { CHILD_ACCOUNT_HINTS, childAccountText } from '../../shared/ui/child-account';
import { CodeBoxes, codeSlots, filledCode } from '../../shared/ui/code-boxes';
import { TextField } from '../../shared/ui/edit-field';
import { fieldHint } from '../../shared/ui/field-hint';
import { LineIcon } from '../../shared/ui/line-icon';
import { ChildForm, LOGIN_PASSWORD_HINTS } from './child-form';

/** The hint for a family code with an empty box. */
const CODE_REQUIRED = '请填家庭码';

/** What a login the api turns down says, without telling which of the three was wrong. */
const LOGIN_FAILED = '家庭码、账号或密码不对';

/**
 * The card of the child login that signs in with the family code, the
 * account and the password (rules.md, 孩子登录页). The family code goes into
 * six boxes by the rules of 输入家庭码, without looking the code up once
 * they are full; the account box takes small letters and digits only, as
 * every box for a child's account does. Remembering this device is not
 * ticked at first.
 *
 * Every field is checked before anything is sent, each mistake said under
 * its field. A login the api turns down does not say which of the three was
 * wrong: 家庭码、账号或密码不对 shows above 登录 and the password box is
 * emptied. A device that has tried too often (rules.md, 限流) is told so in
 * the same place, with the minutes to wait, and the password box is
 * emptied too; 登录 can still be pressed.
 *
 * Given the remembered child whose device has to type the password again
 * (`relogin`), the card says so with the child's avatar, the family code and
 * the account are filled in, and the password box takes the focus; otherwise
 * the first box of the family code does. With `canGoBack`, 返回 at the top
 * left leads back to the children this device remembers.
 */
@Component({
  selector: 'app-child-login-form',
  imports: [Avatar, Button, Card, Checkbox, CodeBoxes, LineIcon, TextField],
  host: { class: 'block w-full' },
  template: `
    <section appCard class="relative w-full animate-rise [animation-delay:150ms]">
      @if (canGoBack()) {
        <span class="absolute top-3 left-3">
          <button type="button" appButton="text" class="pl-2! text-base!" (click)="back.emit()">
            <app-line-icon name="back" />返回
          </button>
        </span>
      }
      <h1 class="text-center text-2xl font-black">孩子登录</h1>
      @if (relogin(); as child) {
        <div role="status" class="mt-5 flex items-center gap-3 rounded-2xl bg-tint px-4 py-3">
          <app-avatar [name]="child.nickname" [personId]="child.childId" size="large" />
          <p class="text-base font-bold">这台设备需要重新输入密码</p>
        </div>
      }
      <form novalidate (submit)="submit($event)">
        <div class="mt-6 flex flex-col gap-5">
          <div>
            <p aria-hidden="true" class="text-base font-bold">家庭码</p>
            <app-code-boxes
              class="mt-2"
              [characters]="code()"
              (charactersChange)="editCode($event)"
              [error]="codeError()"
              [attempt]="attempt()"
              [autofocus]="!relogin()"
            />
          </div>
          <div>
            <span aria-hidden="true" class="block text-base font-bold">账号</span>
            <app-text-field
              class="mt-2 block"
              label="账号"
              [value]="account()"
              (valueChange)="editAccount($event)"
              [error]="accountError()"
              [filter]="accountFilter"
              [attempt]="attempt()"
              [autofocus]="false"
              [large]="true"
            />
          </div>
          <div>
            <span aria-hidden="true" class="block text-base font-bold">密码</span>
            <app-text-field
              class="mt-2 block"
              label="密码"
              [value]="password()"
              (valueChange)="editPassword($event)"
              [error]="passwordError()"
              [attempt]="attempt()"
              [autofocus]="relogin() !== null"
              [large]="true"
              [password]="true"
              autocomplete="current-password"
            />
          </div>
        </div>
        <app-checkbox class="mt-3" [large]="true" [(checked)]="remember"
          >在这台设备上记住我</app-checkbox
        >
        @if (refusal(); as message) {
          <p role="alert" class="mt-2 animate-fade text-base font-bold text-rose-ink">
            {{ message }}
          </p>
        }
        <button
          type="submit"
          appButton
          class="mt-5 min-h-14! w-full text-lg!"
          [disabled]="sending()"
        >
          {{ sending() ? '登录中…' : '登录' }}
        </button>
      </form>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildLoginForm extends ChildForm {
  readonly relogin = input<RememberedChild | null>(null);
  readonly canGoBack = input(false);

  readonly back = output();

  protected readonly accountFilter = childAccountText;

  protected readonly code = linkedSignal<readonly string[]>(() =>
    codeSlots(this.relogin()?.familyCode),
  );
  protected readonly account = linkedSignal(() => this.relogin()?.account ?? '');
  protected readonly codeError = signal<string | null>(null);
  protected readonly accountError = signal<string | null>(null);
  /** Why the api turned the login down, said above 登录; null while it has not. */
  protected readonly refusal = signal<string | null>(null);

  protected editCode(code: readonly string[]): void {
    this.code.set(code);
    this.codeError.set(null);
  }

  protected editAccount(account: string): void {
    this.account.set(account);
    this.accountError.set(null);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) {
      return;
    }
    this.refusal.set(null);
    const code = filledCode(this.code());
    const account = this.account().trim();
    const password = this.password();
    this.codeError.set(code ? null : CODE_REQUIRED);
    this.accountError.set(fieldHint(childAccountSchema, CHILD_ACCOUNT_HINTS, account));
    this.passwordError.set(fieldHint(childPasswordSchema, LOGIN_PASSWORD_HINTS, password));
    if (!code || this.accountError() || this.passwordError()) {
      this.shake();
      return;
    }
    const request = { code, account, password, remember: this.remember() };
    await this.send(() => this.entry.login(request));
  }

  protected explain(error: unknown): boolean {
    const refusal = asApiError(error).code === 'login_failed' ? LOGIN_FAILED : tooManyTries(error);
    if (refusal === null) {
      return false;
    }
    this.refusal.set(refusal);
    this.password.set('');
    return true;
  }
}
