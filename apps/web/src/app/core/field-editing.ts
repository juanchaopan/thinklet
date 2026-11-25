import { inject, signal } from '@angular/core';
import type { FieldHints } from '../shared/ui/field-hint';
import { Toaster } from '../shared/ui/toast';
import { isSignedOut, rejectedFields, showSomethingWentWrong } from './failures';

/**
 * The change of one value of a settings page in progress (rules.md,
 * 个人设置): whether it is being edited, whether the change is on its way,
 * and the hint for a value the server turned down. A change saved closes
 * the editing and says 已保存. It is made where the page is, in its
 * injection context.
 */
export class FieldEditing {
  readonly editing = signal(false);
  readonly saving = signal(false);
  /** The hint for the value the server turned down, shown under its box. */
  readonly serverError = signal<string | null>(null);

  private readonly toaster = inject(Toaster);

  /**
   * @param field the field of the request the value is sent in, which the
   *   server names when it turns the value down
   * @param hints what to say under the box for each reason
   */
  constructor(
    private readonly field: string,
    private readonly hints: FieldHints,
  ) {}

  start(): void {
    this.serverError.set(null);
    this.editing.set(true);
  }

  stop(): void {
    this.editing.set(false);
  }

  /**
   * Sends the change; once the server has saved it, `saved` takes the
   * answer, the editing ends and the 已保存 toast says so. A failure is
   * explained and the value stays as typed.
   */
  async save<T>(send: () => Promise<T>, saved: (answer: T) => void): Promise<void> {
    this.saving.set(true);
    this.serverError.set(null);
    try {
      saved(await send());
      this.editing.set(false);
      this.toaster.show('已保存', 'success', 'party');
    } catch (error) {
      this.explain(error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * A value the server turned down shows its hint under the box; a 401
   * says nothing, as whoever is signed out is on the way to sign in again;
   * any other failure (the server failing or not answering, a request from
   * another site) shows the 出了点问题 toast.
   */
  private explain(error: unknown): void {
    if (isSignedOut(error)) {
      return;
    }
    const rejected = rejectedFields(error).find(({ path }) => path === this.field);
    if (rejected) {
      this.serverError.set(this.hints[rejected.code]);
      return;
    }
    showSomethingWentWrong(this.toaster);
  }
}
