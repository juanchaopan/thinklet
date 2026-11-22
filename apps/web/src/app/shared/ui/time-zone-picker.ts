import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Dialog } from './dialog';
import { LineIcon } from './line-icon';
import {
  searchTimeZones,
  timeZoneOption,
  timeZoneOptions,
  type TimeZoneOption,
} from './time-zones';

let nextPickerId = 0;

/**
 * The dialog that picks a time zone: 选择时区, a search box and the list of
 * every time zone the browser has, sorted by UTC offset. Typing narrows the
 * list by name or offset. One entry is highlighted: the current zone when
 * the list opens, then the first one found. The arrow keys move the
 * highlight and Enter picks it; a click picks any entry. Like every dialog
 * it is a floating sheet on a touch screen and sits in the middle with a
 * mouse; opened from another dialog it lies over it.
 */
@Component({
  selector: 'app-time-zone-picker',
  imports: [Dialog, LineIcon],
  template: `
    <app-dialog [open]="open()" title="选择时区" size="medium" (dismissed)="dismissed.emit()">
      <label
        class="mt-4 flex min-h-12 items-center gap-2 rounded-2xl border border-line-strong bg-surface px-4 focus-within:border-violet focus-within:ring-2 focus-within:ring-violet/20"
      >
        <app-line-icon name="search" class="text-ink-muted" />
        <input
          #box
          type="text"
          role="combobox"
          aria-label="搜索时区"
          aria-autocomplete="list"
          aria-expanded="true"
          autocomplete="off"
          spellcheck="false"
          [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="activeId()"
          [value]="query()"
          (input)="search(box.value)"
          (keydown)="onKeydown($event)"
          class="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>
      <ul
        [id]="listId"
        role="listbox"
        aria-label="时区"
        class="-mx-2 mt-3 max-h-[min(24rem,50vh)] overflow-y-auto"
      >
        @for (option of results(); track option.id; let index = $index) {
          <li
            [id]="optionId(index)"
            role="option"
            tabindex="-1"
            [attr.aria-selected]="index === active()"
            class="flex min-h-12 cursor-pointer items-center rounded-xl px-3 text-base outline-none"
            [class]="index === active() ? 'bg-tint font-bold' : 'hover:bg-canvas'"
            (click)="chosen.emit(option.id)"
            (keydown.enter)="chosen.emit(option.id)"
          >
            {{ option.label }}
          </li>
        }
      </ul>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeZonePicker {
  readonly open = input.required<boolean>();
  /** The zone chosen now, highlighted when the list opens. */
  readonly value = input<string | null>(null);

  readonly chosen = output<string>();
  readonly dismissed = output();

  protected readonly listId = `app-time-zone-list-${String(nextPickerId++)}`;
  protected readonly query = signal('');
  protected readonly active = signal(0);

  private readonly options = signal<readonly TimeZoneOption[]>([]);
  private readonly document = inject(DOCUMENT);

  protected readonly results = computed(() => searchTimeZones(this.options(), this.query()));

  protected readonly activeId = computed(() =>
    this.results().length > 0 ? this.optionId(this.active()) : null,
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.start());
      }
    });
  }

  protected optionId(index: number): string {
    return `${this.listId}-${String(index)}`;
  }

  protected search(query: string): void {
    this.query.set(query);
    this.active.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.highlight(Math.min(count - 1, Math.max(0, this.active() + step)));
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = this.results().at(this.active());
      if (option) {
        this.chosen.emit(option.id);
      }
    }
  }

  /** Lists the zones as of now, from the top, with the current one highlighted and in view. */
  private start(): void {
    const current = this.value();
    this.options.set(timeZoneOptions(new Date(), current ? [current] : []));
    this.query.set('');
    const index = this.results().findIndex((option) => option.id === current);
    this.highlight(Math.max(0, index), 'center');
  }

  private highlight(index: number, block: ScrollLogicalPosition = 'nearest'): void {
    this.active.set(index);
    // The entry is drawn in the next frame; it is brought into view then.
    requestAnimationFrame(() => {
      this.document.getElementById(this.optionId(index))?.scrollIntoView({ block });
    });
  }
}

/**
 * The time zone of a form: the label 时区 over a button showing the chosen
 * zone as "Asia/Shanghai（UTC+08:00）" (empty when none is chosen), which
 * opens the time zone picker. A message under it says what is wrong.
 *
 * Where the label is shown already, as on the family page that edits the
 * zone in place, `showLabel` false leaves it to screen readers. With
 * `autofocus` the button takes the focus when it appears.
 */
@Component({
  selector: 'app-time-zone-field',
  imports: [LineIcon, TimeZonePicker],
  host: { class: 'block' },
  template: `
    <span [id]="labelId" class="block text-sm font-bold" [class.sr-only]="!showLabel()">时区</span>
    <button
      #button
      type="button"
      aria-haspopup="dialog"
      [attr.aria-labelledby]="labelId + ' ' + valueId"
      [attr.aria-describedby]="error() ? errorId : null"
      class="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border bg-surface px-4 text-left text-base outline-none"
      [class.mt-2]="showLabel()"
      [class]="
        error()
          ? 'border-rose-ink ring-2 ring-rose'
          : 'border-line-strong focus-visible:border-violet focus-visible:ring-2 focus-visible:ring-violet/20'
      "
      (click)="picking.set(true)"
    >
      <span [id]="valueId">{{ shown() }}</span>
      <app-line-icon name="chevron" class="text-ink-soft" />
    </button>
    @if (error(); as message) {
      <p [id]="errorId" class="mt-2 animate-fade text-sm font-bold text-rose-ink">{{ message }}</p>
    }
    <app-time-zone-picker
      [open]="picking()"
      [value]="value()"
      (chosen)="choose($event)"
      (dismissed)="picking.set(false)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimeZoneField {
  /** The chosen zone's standard name. */
  readonly value = model<string | null>(null);
  readonly error = input<string | null>(null);
  readonly showLabel = input(true);
  readonly autofocus = input(false);

  protected readonly picking = signal(false);

  private readonly id = String(nextPickerId++);
  protected readonly labelId = `app-time-zone-label-${this.id}`;
  protected readonly valueId = `app-time-zone-value-${this.id}`;
  protected readonly errorId = `app-time-zone-error-${this.id}`;

  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

  protected readonly shown = computed(() => {
    const value = this.value();
    return value ? (timeZoneOption(value, new Date())?.label ?? value) : '';
  });

  constructor() {
    afterNextRender(() => {
      if (this.autofocus()) {
        this.button().nativeElement.focus();
      }
    });
  }

  protected choose(id: string): void {
    this.picking.set(false);
    this.value.set(id);
  }
}
