import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { IconButton } from './button';
import { EditRow, EditSheet, type Validator } from './edit-field';
import { InputMode } from './input-mode';
import { LineIcon } from './line-icon';

/**
 * A value of a settings page that its owner changes with the pencil
 * (rules.md, 个人设置): the value with the pencil, whose screen reader name
 * is `action` ("改名字"); while `editing`, the value edited in place with a
 * mouse, or in a sheet titled `action` on a touch screen. The page keeps
 * whether it is being edited, saves what `save` emits and gives back the
 * server's hint as `error`.
 */
@Component({
  selector: 'app-editable-field',
  imports: [EditRow, EditSheet, IconButton, LineIcon],
  template: `
    @if (editing() && !inputMode.touch()) {
      <app-edit-row
        [value]="value()"
        [label]="label()"
        [validate]="validate()"
        [error]="error()"
        [saving]="saving()"
        (save)="save.emit($event)"
        (cancelled)="cancelled.emit()"
      />
    } @else {
      <div class="flex items-center gap-1">
        <p class="text-base font-bold">{{ value() }}</p>
        <button type="button" appIconButton [attr.aria-label]="action()" (click)="started.emit()">
          <app-line-icon name="pencil" />
        </button>
      </div>
    }
    <app-edit-sheet
      [open]="editing() && inputMode.touch()"
      [title]="action()"
      [value]="value()"
      [label]="label()"
      [validate]="validate()"
      [error]="error()"
      [saving]="saving()"
      (save)="save.emit($event)"
      (cancelled)="cancelled.emit()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditableField {
  readonly value = input.required<string>();
  /** What the value is, the text box's name: 名字, 昵称. */
  readonly label = input.required<string>();
  /** The pencil's name and the sheet's title: 改名字, 改昵称. */
  readonly action = input.required<string>();
  readonly validate = input.required<Validator>();
  readonly editing = input(false);
  readonly saving = input(false);
  readonly error = input<string | null>(null);

  readonly started = output();
  readonly cancelled = output();
  readonly save = output<string>();

  protected readonly inputMode = inject(InputMode);
}
