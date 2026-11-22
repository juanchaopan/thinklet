import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ArtName } from './art';
import { Button } from './button';
import { Dialog } from './dialog';

/**
 * The dialog that asks before an action that cannot simply be taken back:
 * the icon and the question as its title, a line saying what will happen,
 * 取消 and the action. An action that loses something (`danger`) is red.
 * While the action runs (`busy`) its button says 处理中… and cannot be
 * pressed again. 取消, Escape and the backdrop emit `dismissed`.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Button, Dialog],
  template: `
    <app-dialog [open]="open()" [title]="title()" [icon]="icon()" (dismissed)="dismissed.emit()">
      <p class="mt-3 text-base text-ink-soft">{{ text() }}</p>
      <button type="button" appButton="secondary" appDialogAction (click)="dismissed.emit()">
        取消
      </button>
      <button
        type="button"
        [appButton]="danger() ? 'danger' : 'primary'"
        appDialogAction
        [disabled]="busy()"
        (click)="confirmed.emit()"
      >
        {{ busy() ? '处理中…' : action() }}
      </button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  readonly open = input.required<boolean>();
  readonly icon = input.required<ArtName>();
  readonly title = input.required<string>();
  readonly text = input.required<string>();
  readonly action = input.required<string>();
  readonly danger = input(false);
  readonly busy = input(false);

  readonly confirmed = output();
  readonly dismissed = output();
}
