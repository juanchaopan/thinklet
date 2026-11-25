import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PRESS } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { DeleteFamily } from './delete-family';
import { FamilyStore } from './family-store';

let nextNoteId = 0;

/**
 * The row of the ways out of the family at the foot of the family page
 * (rules.md, 权限 and 删除家庭; look.md, 布局), on the right: 离开家庭 and,
 * for the admin, 删除家庭 last. A member leaves after confirming. The admin
 * cannot leave: the button is there but faded (`ink-soft` at 40% opacity)
 * and cannot be pressed, with the reason before it in `ink-muted`,
 * 先把管理员设给别人才能离开. Where the reason and the buttons do not fit on
 * one line, the reason takes a line of its own above them.
 */
@Component({
  selector: 'app-leave-family',
  imports: [ConfirmDialog, DeleteFamily],
  host: { class: 'block' },
  template: `
    @if (store.family(); as family) {
      <div class="flex flex-wrap items-center justify-end gap-2 text-right text-sm text-ink-muted">
        @if (store.admin()) {
          <span [id]="noteId">先把管理员设给别人才能离开</span>
        }
        <div class="flex items-center">
          @if (store.admin()) {
            <button
              type="button"
              class="inline-flex min-h-11 cursor-default items-center justify-center rounded-full px-4 text-sm font-bold text-ink-soft opacity-40"
              disabled
              [attr.aria-describedby]="noteId"
            >
              离开家庭
            </button>
            <app-delete-family />
          } @else {
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-bold text-rose-ink hover:bg-canvas {{
                press
              }}"
              (click)="asking.set(true)"
            >
              离开家庭
            </button>
          }
        </div>
      </div>
      <app-confirm-dialog
        [open]="asking()"
        icon="door"
        [title]="'离开「' + family.name + '」？'"
        text="离开后要重新申请才能回来。"
        action="离开"
        [danger]="true"
        [busy]="store.busy() === 'leave'"
        (confirmed)="leave()"
        (dismissed)="asking.set(false)"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaveFamily {
  protected readonly store = inject(FamilyStore);
  protected readonly press = PRESS;
  protected readonly asking = signal(false);
  protected readonly noteId = `app-leave-family-note-${String(nextNoteId++)}`;

  protected async leave(): Promise<void> {
    await this.store.leave();
    this.asking.set(false);
  }
}
