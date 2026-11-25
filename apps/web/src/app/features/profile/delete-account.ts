import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ACCOUNT_DELETED_URL } from '../../core/account-deleted';
import { Api } from '../../core/api';
import { explainChange } from '../../core/failures';
import { PageNavigation } from '../../core/login';
import { Session } from '../../core/session';
import { PRESS } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Toaster } from '../../shared/ui/toast';

let nextNoteId = 0;

/** A list of family names as the screens write them: each in 「」, one after another. */
function quoted(names: readonly string[]): string {
  return names.map((name) => `「${name}」`).join('');
}

/** What 删除账号 says when the server finds the parent made a family's admin meanwhile. */
const STILL_ADMIN = '你还是家庭的管理员，先把管理员设给别人';

/**
 * 删除账号 at the foot of the profile page, under a thin line, on the right
 * (rules.md, 删除账号; look.md, 布局). While the parent is the admin of any
 * family it is faded (`ink-soft` at 40% opacity) and cannot be pressed,
 * with the reason before it in `ink-muted`: the families they run and what
 * to do first. Otherwise it is a `rose-ink` text button that asks first,
 * naming the families the parent will leave. Once Authing and the site
 * have deleted the account, the browser goes to the product home, where
 * 你的账号已删除 covers the page. A refusal because the parent was made an
 * admin meanwhile says so and reads the parent again, which fades the
 * button; any other failure says 出了点问题 and deletes nothing.
 */
@Component({
  selector: 'app-delete-account',
  imports: [ConfirmDialog],
  host: { class: 'block border-t border-line pt-4' },
  template: `
    @if (adminReason(); as reason) {
      <div class="flex flex-wrap items-center justify-end gap-2 text-right text-sm text-ink-muted">
        <span [id]="noteId">{{ reason }}</span>
        <button
          type="button"
          class="inline-flex min-h-11 cursor-default items-center justify-center rounded-full px-4 text-sm font-bold text-ink-soft opacity-40"
          disabled
          [attr.aria-describedby]="noteId"
        >
          删除账号
        </button>
      </div>
    } @else {
      <div class="flex justify-end">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-bold text-rose-ink hover:bg-canvas {{
            press
          }}"
          (click)="asking.set(true)"
        >
          删除账号
        </button>
      </div>
    }
    <app-confirm-dialog
      [open]="asking()"
      icon="door"
      title="删除你的账号？"
      [text]="consequences()"
      action="删除账号"
      [danger]="true"
      [busy]="deleting()"
      (confirmed)="deleteAccount()"
      (dismissed)="asking.set(false)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccount {
  private readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly page = inject(PageNavigation);
  private readonly toaster = inject(Toaster);

  protected readonly press = PRESS;
  protected readonly noteId = `app-delete-account-note-${String(nextNoteId++)}`;
  protected readonly asking = signal(false);
  protected readonly deleting = signal(false);

  private readonly families = computed(() => this.session.me()?.families ?? []);

  /** Why the account cannot be deleted yet, naming the families the parent runs; empty when it can. */
  protected readonly adminReason = computed(() => {
    const running = this.families().filter((family) => family.role === 'admin');
    return running.length === 0
      ? ''
      : `你还是${quoted(running.map((family) => family.name))}的管理员，先把管理员设给别人或者删除家庭，才能删除账号`;
  });

  /** What the question says will happen: the families left, when there are any, and the account gone. */
  protected readonly consequences = computed(() => {
    const names = this.families().map((family) => family.name);
    const leaving = names.length > 0 ? `你会离开${quoted(names)}。` : '';
    return `${leaving}你在好奇星球和 Authing 上的账号都会删掉，不能恢复。`;
  });

  protected async deleteAccount(): Promise<void> {
    this.deleting.set(true);
    try {
      await this.api.sendWithoutContent('DELETE', '/api/me');
      this.page.go(ACCOUNT_DELETED_URL);
    } catch (error) {
      explainChange(error, this.toaster, { still_admin: STILL_ADMIN }, () => {
        void this.session.refresh();
      });
      this.asking.set(false);
      this.deleting.set(false);
    }
  }
}
