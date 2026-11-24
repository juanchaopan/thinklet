import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { Avatar } from './avatar';
import { Button } from './button';
import { Dialog } from './dialog';
import { LineIcon } from './line-icon';

/** A child of the family, as the dialog lists them. */
export interface FamilyChild {
  readonly id: string;
  readonly nickname: string;
}

/** Whether two lists hold the same ids, in any order. */
function sameIds(first: ReadonlySet<string>, second: readonly string[]): boolean {
  return first.size === new Set(second).size && second.every((id) => first.has(id));
}

/**
 * 谁能读《<title>》 (rules.md, 谁能读): every child of the family in the order
 * they were added, one row each with the avatar and the nickname; the whole
 * row ticks or unticks the child. A ticked row is tinted and ends in the
 * violet tick. The choice starts from the children who read the book each
 * time the dialog opens.
 *
 * 取消 is always there; 确定 appears only once the choice differs from the
 * readers, and emits the children chosen. An inactive book (`retired`)
 * cannot go to anyone new: the rows of children who do not read it are
 * faded and cannot be pressed, and a line under the list says so. While the
 * choice is saved (`busy`) 确定 says 处理中… and cannot be pressed again.
 */
@Component({
  selector: 'app-readers-dialog',
  imports: [Avatar, Button, Dialog, LineIcon],
  template: `
    <app-dialog
      [open]="open()"
      [title]="'谁能读《' + title() + '》'"
      size="large"
      (dismissed)="dismissed.emit()"
    >
      @if (children().length > 0) {
        <ul class="mt-4 flex flex-col gap-1">
          @for (child of children(); track child.id) {
            <li>
              <button
                type="button"
                role="checkbox"
                class="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left"
                [class]="rowClasses(child.id)"
                [attr.aria-checked]="chosen().has(child.id)"
                [disabled]="locked(child.id)"
                (click)="toggle(child.id)"
              >
                <app-avatar [name]="child.nickname" [personId]="child.id" size="large" />
                <span class="min-w-0 flex-1 truncate text-base font-bold">{{
                  child.nickname
                }}</span>
                @if (chosen().has(child.id)) {
                  <app-line-icon name="check" class="text-violet" />
                }
              </button>
            </li>
          }
        </ul>
        @if (retired()) {
          <p class="mt-3 px-3 text-sm text-ink-muted">下架的书不能再分派</p>
        }
      } @else {
        <p class="mt-3 text-base text-ink-soft">
          家里还没有孩子。在「孩子」里添加孩子后，就能选谁能读。
        </p>
      }
      <button type="button" appButton="secondary" appDialogAction (click)="dismissed.emit()">
        取消
      </button>
      @if (changed()) {
        <button
          type="button"
          appButton
          appDialogAction
          [disabled]="busy()"
          (click)="confirmed.emit(choice())"
        >
          {{ busy() ? '处理中…' : '确定' }}
        </button>
      }
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadersDialog {
  readonly open = input.required<boolean>();
  /** The book's title. */
  readonly title = input.required<string>();
  readonly children = input.required<readonly FamilyChild[]>();
  /** The ids of the children who read the book. */
  readonly readers = input.required<readonly string[]>();
  readonly retired = input(false);
  readonly busy = input(false);

  /** The children chosen to read the book, every one of them. */
  readonly confirmed = output<string[]>();
  readonly dismissed = output();

  /** The children ticked so far, from the readers each time the dialog opens. */
  protected readonly chosen = linkedSignal({
    source: () => ({ open: this.open(), readers: this.readers() }),
    computation: ({ readers }) => new Set(readers),
  });

  protected readonly changed = computed(() => !sameIds(this.chosen(), this.readers()));

  /** The children chosen, in the order the family added them. */
  protected choice(): string[] {
    const chosen = this.chosen();
    const known = this.children().map(({ id }) => id);
    return [
      ...known.filter((id) => chosen.has(id)),
      ...[...chosen].filter((id) => !known.includes(id)),
    ];
  }

  /** A child who does not read an inactive book cannot be given it. */
  protected locked(childId: string): boolean {
    return this.retired() && !this.readers().includes(childId);
  }

  protected rowClasses(childId: string): string {
    if (this.locked(childId)) {
      return 'cursor-not-allowed opacity-45';
    }
    return this.chosen().has(childId) ? 'bg-tint' : 'hover:bg-canvas';
  }

  protected toggle(childId: string): void {
    this.chosen.update((chosen) => {
      const next = new Set(chosen);
      if (!next.delete(childId)) {
        next.add(childId);
      }
      return next;
    });
  }
}
