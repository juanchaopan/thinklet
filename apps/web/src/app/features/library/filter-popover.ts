import { CdkTrapFocus } from '@angular/cdk/a11y';
import { TemplatePortal } from '@angular/cdk/portal';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  Injector,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { Button } from '../../shared/ui/button';
import { SHEET_FRAME } from '../../shared/ui/dialog';
import { Layer, fullScreenLayer } from '../../shared/ui/layer';
import { dropDownLayer } from '../../shared/ui/menu';

/** How wide each filter's drop-down is: grades three to a row, subjects two, scopes one. */
export type FilterWidth = 'grade' | 'subject' | 'scope';

const WIDTHS: Record<FilterWidth, string> = { grade: 'w-80', subject: 'w-64', scope: 'w-56' };

/** The gap between a filter's button and its drop-down, in px. */
const DROP_GAP = 8;

let nextPopoverId = 0;

/**
 * The options of one filter of the library (look.md, 书), opened from the
 * filter's button. With a mouse they drop down 8 px below the button in
 * 150 ms; on a touch screen they rise in a sheet headed by the filter's
 * name, as menus do. A filter that takes several values (`multiple`) ends
 * with 清除, which emits `cleared`, and 完成, which only closes it: in the
 * drop-down the two share a compact row, in the sheet they follow the
 * dialogs' buttons.
 *
 * The focus moves into the options and stays there while they are open;
 * Escape, 完成 and a click outside emit `dismissed`, the owner then sets
 * `open` to false, and the focus goes back to the button.
 */
@Component({
  selector: 'app-filter-popover',
  imports: [Button, CdkTrapFocus, NgTemplateOutlet],
  template: `
    <ng-template #options><ng-content /></ng-template>

    <ng-template #dropDownFrame>
      <div
        role="dialog"
        tabindex="-1"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        [attr.aria-label]="label()"
        class="origin-top-left rounded-2xl border border-line bg-surface p-1.5 shadow-pop outline-none"
        [class]="dropDownClasses()"
        (keydown.escape)="dismissed.emit()"
      >
        <ng-container [ngTemplateOutlet]="options" />
        @if (multiple()) {
          <div class="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
            <button type="button" appButton="text" (click)="cleared.emit()">清除</button>
            <button type="button" appButton [compact]="true" (click)="dismissed.emit()">
              完成
            </button>
          </div>
        }
      </div>
    </ng-template>

    <ng-template #sheetFrame>
      <div class="fixed inset-0 flex items-end justify-center {{ sheetSpacing }}">
        <div
          aria-hidden="true"
          class="absolute inset-0 bg-ink/45"
          [class]="layer.leaving() ? 'animate-fade-out' : 'animate-fade'"
          (click)="dismissed.emit()"
        ></div>
        <div
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          [attr.aria-labelledby]="titleId"
          class="relative w-full max-w-sheet rounded-t-sheet bg-surface p-4 pb-8 outline-none touch:rounded-sheet touch:pb-4"
          [class]="sheetClasses()"
          (keydown.escape)="dismissed.emit()"
        >
          <p [id]="titleId" class="px-3 pt-2 pb-3 text-lg font-black">{{ label() }}</p>
          <ng-container [ngTemplateOutlet]="options" />
          @if (multiple()) {
            <div
              class="mt-3 flex flex-col-reverse gap-3 border-t border-line px-1 pt-3 sm:flex-row sm:justify-end"
            >
              <button type="button" appButton="secondary" (click)="cleared.emit()">清除</button>
              <button type="button" appButton (click)="dismissed.emit()">完成</button>
            </div>
          }
        </div>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterPopover {
  readonly open = input.required<boolean>();
  /** The filter's name: the sheet's heading, and the options' name for screen readers. */
  readonly label = input.required<string>();
  /** The filter's button; the drop-down unfolds below it. */
  readonly origin = input.required<HTMLElement>();
  readonly dropDown = input(true);
  readonly width = input.required<FilterWidth>();
  readonly multiple = input(false);

  readonly dismissed = output();
  readonly cleared = output();

  private readonly injector = inject(Injector);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly document = inject(DOCUMENT);

  protected readonly sheetSpacing = SHEET_FRAME;
  protected readonly titleId = `app-filter-popover-${String(nextPopoverId++)}`;
  protected readonly layer = new Layer(this.injector);

  protected readonly dropDownClasses = computed(
    () => `${WIDTHS[this.width()]} ${this.layer.leaving() ? 'animate-drop-out' : 'animate-drop'}`,
  );
  protected readonly sheetClasses = computed(() =>
    this.layer.leaving()
      ? 'animate-sheet-out touch:animate-float-out'
      : 'animate-sheet touch:animate-float',
  );

  private readonly dropDownFrame = viewChild<TemplateRef<unknown>>('dropDownFrame');
  private readonly sheetFrame = viewChild<TemplateRef<unknown>>('sheetFrame');

  /** The frame the options are shown in now, as the input device asks; none while closed. */
  private readonly shownFrame = computed(() => {
    if (!this.open()) {
      return null;
    }
    return (this.dropDown() ? this.dropDownFrame() : this.sheetFrame()) ?? null;
  });

  /** The button the options were opened from, while they are shown. */
  private openedFrom: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const frame = this.shownFrame();
      untracked(() => {
        if (frame) {
          this.showIn(frame);
        } else {
          this.close();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.layer.remove();
    });
  }

  private showIn(frame: TemplateRef<unknown>): void {
    this.openedFrom = this.origin();
    const config =
      frame === this.dropDownFrame()
        ? dropDownLayer(this.injector, this.openedFrom, 'start', DROP_GAP)
        : fullScreenLayer(this.injector);
    this.layer.show(new TemplatePortal(frame, this.viewContainer), config, () => {
      this.dismissed.emit();
    });
  }

  /**
   * Closes the options. The focus goes back to the button when it was among
   * the options or nowhere, and stays where the parent moved it otherwise.
   */
  private close(): void {
    const button = this.openedFrom;
    if (!button) {
      return;
    }
    this.openedFrom = null;
    const focused = this.document.activeElement;
    const layers = this.document.querySelector('.cdk-overlay-container');
    const lost = focused === null || focused === this.document.body || layers?.contains(focused);
    this.layer.hide();
    if (lost) {
      button.focus();
    }
  }
}
