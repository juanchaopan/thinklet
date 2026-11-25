import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { newChildPasswordSchema, type FieldErrorCode } from '@thinklet/contracts';
import { rejectedFields } from '../../core/failures';
import { TextField } from '../../shared/ui/edit-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';

/** The hints for a new password that cannot be set (rules.md, 孩子). */
const NEW_PASSWORD_HINTS: FieldHints = {
  required: '请设密码',
  too_short: '密码至少 6 个字符',
  too_long: '密码最多 32 个字符',
  invalid: '请设密码',
};

/** The hint for a second password that differs from the first. */
const MISMATCH = '两次输的密码不一样';

/**
 * The two boxes a child sets a first password in (rules.md, 孩子): 密码,
 * with 6–32 个字符 under it and the focus when it appears, and 再输一遍,
 * both with 显示密码. The form that holds them asks `checked()` for the
 * password before sending it: a password that cannot be set says why
 * under the first box, and a second one that differs is said under the
 * second box and emptied for typing again; either shakes the boxes. A
 * password the api turns down is said with `refuse`, or with
 * `refuseRejected` from the api's error.
 */
@Component({
  selector: 'app-new-password-fields',
  imports: [TextField],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-5">
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewPasswordFields {
  protected readonly password = signal('');
  protected readonly repeat = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly repeatError = signal<string | null>(null);
  /** Counts the refused attempts; each new one shakes the boxes that show a message. */
  protected readonly attempt = signal(0);

  /**
   * The password typed twice when it may be set; else null, with what is
   * wrong said under its box.
   */
  checked(): string | null {
    const password = this.password();
    this.passwordError.set(fieldHint(newChildPasswordSchema, NEW_PASSWORD_HINTS, password));
    const differs = this.passwordError() === null && this.repeat() !== password;
    this.repeatError.set(differs ? MISMATCH : null);
    if (differs) {
      this.repeat.set('');
    }
    if (this.passwordError() || this.repeatError()) {
      this.shake();
      return null;
    }
    return password;
  }

  /** Says under the first box why the api turned the password down. */
  refuse(code: FieldErrorCode): void {
    this.passwordError.set(NEW_PASSWORD_HINTS[code]);
    this.shake();
  }

  /**
   * Says under the first box why the api turned the password down when the
   * error rejects the `password` field; returns whether it did.
   */
  refuseRejected(error: unknown): boolean {
    const field = rejectedFields(error).find((rejected) => rejected.path === 'password');
    if (field) {
      this.refuse(field.code);
    }
    return field !== undefined;
  }

  protected editPassword(password: string): void {
    this.password.set(password);
    this.passwordError.set(null);
  }

  protected editRepeat(repeat: string): void {
    this.repeat.set(repeat);
    this.repeatError.set(null);
  }

  private shake(): void {
    this.attempt.update((count) => count + 1);
  }
}
