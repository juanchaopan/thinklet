import { Directive, inject, input, output, signal } from '@angular/core';
import type { ChildLoginLinkInfo, ErrorCode } from '@thinklet/contracts';
import { asApiError, showSomethingWentWrong } from '../../core/failures';
import type { FieldHints } from '../../shared/ui/field-hint';
import { Toaster } from '../../shared/ui/toast';
import { ChildEntry } from './child-entry';

/**
 * The hints for a password typed to log in (rules.md, 孩子): it is only
 * checked for being there, so every reason says to fill it in.
 */
export const LOGIN_PASSWORD_HINTS: FieldHints = {
  required: '请填密码',
  too_short: '请填密码',
  too_long: '请填密码',
  invalid: '请填密码',
};

/**
 * What every form that signs a child in shares: the password, remembering
 * this device (not ticked at first unless the form says so), the password's
 * message, the count of attempts that shakes the fields, and sending. While
 * a login is on its way the form sends nothing more; a failure the form does
 * not explain itself is 出了点问题, with what was typed kept.
 */
@Directive()
export abstract class ChildForm {
  protected readonly entry = inject(ChildEntry);
  private readonly toaster = inject(Toaster);

  protected readonly password = signal('');
  protected readonly remember = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly attempt = signal(0);
  protected readonly sending = signal(false);

  protected editPassword(password: string): void {
    this.password.set(password);
    this.passwordError.set(null);
  }

  /** Shakes the fields that show a message. */
  protected shake(): void {
    this.attempt.update((count) => count + 1);
  }

  /** Signs in with `login`, once at a time, explaining a failure. */
  protected async send(login: () => Promise<void>): Promise<void> {
    if (this.sending()) {
      return;
    }
    this.sending.set(true);
    try {
      await login();
    } catch (error) {
      if (!this.explain(error)) {
        showSomethingWentWrong(this.toaster);
      }
    } finally {
      this.sending.set(false);
    }
  }

  /** Says what the failure means on the form; false for one it has nothing to say about. */
  protected abstract explain(error: unknown): boolean;
}

/**
 * A form of the QR login page, for the link's child. Remembering this device
 * is ticked from the start, since the child signs in on their own device. A
 * link that turns out to be for a child whose password was set or reset
 * meanwhile (`stale`, answered with the form's `staleCode`) or no longer
 * valid (`gone`) is left to the page.
 */
@Directive()
export abstract class QrForm extends ChildForm {
  readonly token = input.required<string>();
  readonly link = input.required<ChildLoginLinkInfo>();

  readonly stale = output();
  readonly gone = output();

  protected override readonly remember = signal(true);
  protected abstract readonly staleCode: ErrorCode;

  /** Hands a stale or used-up link to the page; true when it was one. */
  protected leftToPage(error: unknown): boolean {
    const { code } = asApiError(error);
    if (code === this.staleCode) {
      this.stale.emit();
    } else if (code === 'link_invalid') {
      this.gone.emit();
    } else {
      return false;
    }
    return true;
  }
}
