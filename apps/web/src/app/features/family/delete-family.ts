import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PRESS } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { FamilyStore } from './family-store';

/**
 * What the question before deleting a family says will happen (rules.md,
 * 删除家庭): the children and their books and learning records deleted, and
 * the other parents leaving, each half left out when there are none, then
 * that it cannot be undone.
 */
export function deletionConsequences(children: number, otherParents: number): string {
  const halves = [
    ...(children > 0 ? [`${String(children)} 个孩子和他们的书、学习记录都会删掉`] : []),
    ...(otherParents > 0 ? [`另外 ${String(otherParents)} 位家长会离开这个家庭`] : []),
  ];
  return `${halves.length > 0 ? `${halves.join('，')}。` : ''}不能恢复。`;
}

/**
 * 删除家庭, the admin's `rose-ink` text button at the end of the row of
 * 离开家庭 at the foot of the family page (rules.md, 删除家庭; look.md,
 * 布局). It first reads how many children the family has now, then asks,
 * naming them and the other parents who will leave; once the family is
 * deleted the admin goes on to the library of their next family.
 */
@Component({
  selector: 'app-delete-family',
  imports: [ConfirmDialog],
  template: `
    @if (store.family(); as family) {
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-bold text-rose-ink hover:bg-canvas {{
          press
        }}"
        [disabled]="store.busy() === 'count'"
        (click)="ask()"
      >
        删除家庭
      </button>
      <app-confirm-dialog
        [open]="children() !== null"
        icon="door"
        [title]="'删除「' + family.name + '」？'"
        [text]="consequences()"
        action="删除家庭"
        [danger]="true"
        [busy]="store.busy() === 'delete'"
        (confirmed)="deleteFamily()"
        (dismissed)="children.set(null)"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteFamily {
  protected readonly store = inject(FamilyStore);
  protected readonly press = PRESS;
  /** How many children the family has, while the question is open; null while it is not. */
  protected readonly children = signal<number | null>(null);

  protected readonly consequences = computed(() =>
    deletionConsequences(
      this.children() ?? 0,
      Math.max((this.store.family()?.members.length ?? 1) - 1, 0),
    ),
  );

  protected async ask(): Promise<void> {
    const count = await this.store.countChildren();
    if (count !== undefined) {
      this.children.set(count);
    }
  }

  protected async deleteFamily(): Promise<void> {
    await this.store.deleteFamily();
    this.children.set(null);
  }
}
