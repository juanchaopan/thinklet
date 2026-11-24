import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PRESS } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { FamilyStore } from './family-store';

let nextNoteId = 0;

/**
 * 离开家庭 at the foot of the family page (rules.md, 权限). A member leaves
 * after confirming. The admin cannot leave: the button is there but faded
 * (`ink-soft` at 40% opacity, look.md, 布局) and cannot be pressed, with the
 * reason before it in `ink-muted`, 先把管理员设给别人才能离开.
 */
@Component({
  selector: 'app-leave-family',
  imports: [ConfirmDialog],
  host: { class: 'block' },
  template: `
    @if (store.family(); as family) {
      @if (store.admin()) {
        <div class="flex flex-wrap items-center justify-end gap-2 text-sm text-ink-muted">
          <span [id]="noteId">先把管理员设给别人才能离开</span>
          <button
            type="button"
            class="inline-flex min-h-11 cursor-default items-center justify-center rounded-full px-4 text-sm font-bold text-ink-soft opacity-40"
            disabled
            [attr.aria-describedby]="noteId"
          >
            离开家庭
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
            离开家庭
          </button>
        </div>
      }
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
