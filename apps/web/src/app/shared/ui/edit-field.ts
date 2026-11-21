import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  afterNextRender,
  computed,
  effect,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Button } from './button';
import { Dialog } from './dialog';

let nextFieldId = 0;

/** Turns a typed value into the message to show, or null when it may be saved. */
export type Validator = (value: string) => string | null;

/**
 * A text box. With an error it turns red, shakes 6 px to each side in 300 ms
 * and shows the message under it, fading in over 200 ms; it shakes again for
 * every new `attempt`. With `autofocus` it takes the focus when it appears.
 */
@Component({
  selector: 'app-text-field',
  template: `
    <input
      #box
      type="text"
      [attr.aria-label]="label()"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="error() ? errorId : null"
      [value]="value()"
      (input)="value.set(box.value)"
      class="block min-h-12 w-full rounded-2xl border bg-surface px-4 text-base outline-none"
      [class]="
        error()
          ? 'border-rose-ink ring-2 ring-rose'
          : 'border-line-strong focus:border-violet focus:ring-2 focus:ring-violet/20'
      "
    />
    @if (error(); as message) {
      <p [id]="errorId" class="mt-2 animate-fade text-sm font-bold text-rose-ink">{{ message }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextField {
  readonly value = model.required<string>();
  readonly label = input.required<string>();
  readonly error = input<string | null>(null);
  /** Counts the failed attempts to save; each new one shakes the box. */
  readonly attempt = input(0);
  readonly autofocus = input(true);

  protected readonly errorId = `app-text-field-error-${String(nextFieldId++)}`;

  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  constructor() {
    afterNextRender(() => {
      if (this.autofocus()) {
        this.box().nativeElement.focus();
      }
    });
    effect(() => {
      if (this.attempt() > 0 && this.error()) {
        untracked(() => this.shake());
      }
    });
  }

  private shake(): void {
    const box = this.box().nativeElement;
    box.classList.remove('animate-shake');
    // Reading the layout restarts the animation when the class comes back.
    box.getBoundingClientRect();
    box.classList.add('animate-shake');
  }
}

/**
 * What the two ways of editing a value share: the draft starts as the
 * current value; a value that fails `validate` shows its message, shakes the
 * box and is not saved; a value that passes is emitted with `save`. `error`
 * is a message from the server, shown the same way.
 */
@Directive()
abstract class EditBase {
  readonly value = input.required<string>();
  readonly label = input.required<string>();
  readonly validate = input.required<Validator>();
  readonly error = input<string | null>(null);
  readonly saving = input(false);

  readonly save = output<string>();
  readonly cancelled = output();

  protected readonly draft = linkedSignal(() => this.value());
  protected readonly attempt = signal(0);
  private readonly checkError = signal<string | null>(null);

  protected readonly shownError = computed(() => this.checkError() ?? this.error());

  constructor() {
    effect(() => {
      if (this.error()) {
        untracked(() => this.attempt.update((count) => count + 1));
      }
    });
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    if (this.saving()) {
      return;
    }
    const message = this.validate()(this.draft());
    this.checkError.set(message);
    if (message) {
      this.attempt.update((count) => count + 1);
      return;
    }
    this.save.emit(this.draft());
  }

  protected edited(value: string): void {
    this.draft.set(value);
    this.checkError.set(null);
  }

  /** Starts over from the current value. */
  protected restart(): void {
    this.draft.set(this.value());
    this.checkError.set(null);
    this.attempt.set(0);
  }
}

/**
 * Editing in place with a mouse: the text box with 取消 and 保存 beside it
 * (under it below 640 px), fading in over 200 ms where the value was. Enter
 * saves; Escape cancels.
 */
@Component({
  selector: 'app-edit-row',
  imports: [Button, TextField],
  template: `
    <form
      class="flex animate-fade flex-col gap-3 sm:flex-row"
      [class]="shownError() ? 'sm:items-start' : 'sm:items-center'"
      (submit)="submit($event)"
      (keydown.escape)="cancelled.emit()"
    >
      <app-text-field
        class="block flex-1"
        [value]="draft()"
        (valueChange)="edited($event)"
        [label]="label()"
        [error]="shownError()"
        [attempt]="attempt()"
      />
      <div class="flex gap-2" [class.sm:mt-0.5]="shownError()">
        <button
          type="button"
          appButton="text"
          class="flex-1 border border-line sm:flex-none"
          (click)="cancelled.emit()"
        >
          取消
        </button>
        <button
          type="submit"
          appButton
          [compact]="true"
          class="flex-1 sm:flex-none"
          [disabled]="saving()"
        >
          {{ saving() ? '保存中…' : '保存' }}
        </button>
      </div>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditRow extends EditBase {}

/**
 * Editing on a touch screen: a sheet titled `title` with the text box,
 * prefilled with the current value, and 取消 and 保存. The box takes the
 * focus when the sheet opens. Enter saves; Escape and the backdrop cancel.
 */
@Component({
  selector: 'app-edit-sheet',
  imports: [Button, Dialog, TextField],
  template: `
    <app-dialog [open]="open()" [title]="title()" (dismissed)="cancelled.emit()">
      <form class="mt-5" (submit)="submit($event)">
        <app-text-field
          [value]="draft()"
          (valueChange)="edited($event)"
          [label]="label()"
          [error]="shownError()"
          [attempt]="attempt()"
          [autofocus]="false"
        />
      </form>
      <button type="button" appButton="secondary" appDialogAction (click)="cancelled.emit()">
        取消
      </button>
      <button type="button" appButton appDialogAction [disabled]="saving()" (click)="submit()">
        {{ saving() ? '保存中…' : '保存' }}
      </button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditSheet extends EditBase {
  readonly open = input.required<boolean>();
  readonly title = input.required<string>();

  constructor() {
    super();
    effect(() => {
      if (this.open()) {
        untracked(() => this.restart());
      }
    });
  }
}
