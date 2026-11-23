import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  childAccountSchema,
  childNicknameSchema,
  guardianConsentSchema,
  type Child,
} from '@thinklet/contracts';
import { Button } from '../../shared/ui/button';
import { Checkbox } from '../../shared/ui/checkbox';
import { CHILD_ACCOUNT_HINT, childAccountText } from '../../shared/ui/child-account';
import { Dialog } from '../../shared/ui/dialog';
import { TextField } from '../../shared/ui/edit-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';
import { ChildrenStore, type RejectedField } from './children-store';

/**
 * The hints for a nickname that cannot be saved (rules.md, 孩子). A nickname
 * is too short only when it is empty, so both say to fill it in.
 */
const NICKNAME_HINTS: FieldHints = {
  required: '请填昵称',
  too_short: '请填昵称',
  too_long: '昵称最多 10 个字',
  invalid: '请填昵称',
};

/**
 * The hints for an account that cannot be saved. The box takes only small
 * letters and digits, at most 20 of them, so an empty account is the one
 * mistake it lets through.
 */
const ACCOUNT_HINTS: FieldHints = {
  required: '请填账号',
  too_short: '请填账号',
  too_long: '请填账号',
  invalid: '请填账号',
};

/** The hint for an account another child of the family has (interfaces.md, 错误码). */
const ACCOUNT_TAKEN = '家里已经有孩子用这个账号了';

/** The hint for a consent not given. */
const CONSENT_HINT = '请先同意';

/** What the guardian agrees to when adding a child (rules.md, 孩子). */
export const CONSENT_TEXT = '我是这个孩子的监护人，同意好奇星球处理孩子的昵称、账号和登录记录';

/**
 * The dialog that adds a child (添加孩子), or changes a child's nickname and
 * account (修改<昵称>) when given the `child` (rules.md, 添加和修改孩子).
 * Adding also asks for the guardian's consent, not ticked at first. The
 * account box lowers capitals and takes only letters and digits, with the
 * rule said under it.
 *
 * Every field is checked before anything is sent, each mistake said under
 * its field; an account the server says another child has is said under the
 * account until the account is changed. A saved child closes the dialog; a
 * child deleted meanwhile closes it too, once that has been said.
 */
@Component({
  selector: 'app-child-form-dialog',
  imports: [Button, Checkbox, Dialog, TextField],
  template: `
    <app-dialog
      [open]="open()"
      [title]="title()"
      [icon]="child() ? 'consent' : 'child'"
      size="large"
      (dismissed)="closed.emit()"
    >
      <form class="mt-6 flex flex-col gap-5" (submit)="save($event)">
        <div>
          <span aria-hidden="true" class="block text-sm font-bold">昵称</span>
          <app-text-field
            class="mt-2 block"
            label="昵称"
            [value]="nickname()"
            (valueChange)="editNickname($event)"
            [error]="nicknameError()"
            [attempt]="attempt()"
            [autofocus]="false"
          />
        </div>
        <div>
          <span aria-hidden="true" class="block text-sm font-bold">账号</span>
          <app-text-field
            class="mt-2 block"
            label="账号"
            [value]="account()"
            (valueChange)="editAccount($event)"
            [error]="accountError()"
            [hint]="accountHint"
            [filter]="accountFilter"
            [attempt]="attempt()"
            [autofocus]="false"
          />
        </div>
        @if (!child()) {
          <app-checkbox
            [checked]="consent()"
            (checkedChange)="editConsent($event)"
            [error]="consentError()"
            >{{ consentText }}</app-checkbox
          >
        }
      </form>
      <button type="button" appButton="secondary" appDialogAction (click)="closed.emit()">
        取消
      </button>
      <button type="button" appButton appDialogAction [disabled]="saving()" (click)="save()">
        {{ actionText() }}
      </button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildFormDialog {
  readonly open = input.required<boolean>();
  /** The child whose nickname and account are changed; none when adding a child. */
  readonly child = input<Child | null>(null);

  readonly closed = output();

  private readonly store = inject(ChildrenStore);

  protected readonly consentText = CONSENT_TEXT;
  protected readonly accountHint = CHILD_ACCOUNT_HINT;
  protected readonly accountFilter = childAccountText;

  protected readonly nickname = signal('');
  protected readonly account = signal('');
  protected readonly consent = signal(false);
  protected readonly nicknameError = signal<string | null>(null);
  protected readonly accountError = signal<string | null>(null);
  protected readonly consentError = signal<string | null>(null);
  protected readonly attempt = signal(0);
  protected readonly saving = signal(false);
  /** The account the server said another child has, until the account is changed. */
  private readonly takenAccount = signal<string | null>(null);

  protected readonly title = computed(() => {
    const child = this.child();
    return child ? `修改${child.nickname}` : '添加孩子';
  });

  protected readonly actionText = computed(() => {
    if (this.child()) {
      return this.saving() ? '保存中…' : '保存';
    }
    return this.saving() ? '添加中…' : '添加';
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.start());
      }
    });
  }

  protected editNickname(nickname: string): void {
    this.nickname.set(nickname);
    this.nicknameError.set(null);
  }

  protected editAccount(account: string): void {
    this.account.set(account);
    this.accountError.set(null);
  }

  protected editConsent(consent: boolean): void {
    this.consent.set(consent);
    this.consentError.set(null);
  }

  protected async save(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.saving() || !this.checked()) {
      return;
    }
    this.saving.set(true);
    try {
      const child = this.child();
      const nickname = this.nickname().trim();
      const account = this.account().trim();
      const result = child
        ? await this.store.update(child, { nickname, account })
        : await this.store.add({ nickname, account, consent: true });
      if (result.outcome === 'rejected') {
        this.showRejected(result.fields);
      } else if (result.outcome !== 'failed') {
        this.closed.emit();
      }
    } finally {
      this.saving.set(false);
    }
  }

  /** Checks every field before sending, says each mistake under its field and shakes them. */
  private checked(): boolean {
    const account = this.account().trim();
    this.nicknameError.set(fieldHint(childNicknameSchema, NICKNAME_HINTS, this.nickname()));
    this.accountError.set(
      fieldHint(childAccountSchema, ACCOUNT_HINTS, account) ??
        (account === this.takenAccount() ? ACCOUNT_TAKEN : null),
    );
    const consentGiven =
      this.child() !== null || guardianConsentSchema.safeParse(this.consent()).success;
    this.consentError.set(consentGiven ? null : CONSENT_HINT);
    if (this.nicknameError() || this.accountError() || this.consentError()) {
      this.attempt.update((count) => count + 1);
      return false;
    }
    return true;
  }

  /** Says under each field why the server turned it down, as the checks before sending do. */
  private showRejected(fields: readonly RejectedField[]): void {
    for (const field of fields) {
      if (field.path === 'nickname' && field.code !== 'taken') {
        this.nicknameError.set(NICKNAME_HINTS[field.code]);
      } else if (field.path === 'account') {
        if (field.code === 'taken') {
          this.takenAccount.set(this.account().trim());
        }
        this.accountError.set(field.code === 'taken' ? ACCOUNT_TAKEN : ACCOUNT_HINTS[field.code]);
      } else if (field.path === 'consent') {
        this.consentError.set(CONSENT_HINT);
      }
    }
    this.attempt.update((count) => count + 1);
  }

  /** Starts over: empty fields to add a child, the child's own to change one. */
  private start(): void {
    const child = this.child();
    this.nickname.set(child?.nickname ?? '');
    this.account.set(child?.account ?? '');
    this.consent.set(false);
    this.nicknameError.set(null);
    this.accountError.set(null);
    this.consentError.set(null);
    this.takenAccount.set(null);
    this.attempt.set(0);
    this.saving.set(false);
  }
}
