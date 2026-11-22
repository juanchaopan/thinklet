import { CdkTrapFocus } from '@angular/cdk/a11y';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
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
import { Art, type ArtName } from './art';
import { IconButton } from './button';
import { Layer, fullScreenLayer } from './layer';
import { LineIcon } from './line-icon';

let nextDialogId = 0;

/**
 * Spacing of the layer that holds a sheet on a touch screen: 12 px from the
 * sides and the bottom on phones, 16 px from the bottom from 640 px up, each
 * plus the device's safe area at the bottom.
 */
export const SHEET_FRAME =
  'touch:px-3 touch:pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] touch:sm:pb-[calc(1rem_+_env(safe-area-inset-bottom))]';

const PANEL_ENTER = 'animate-sheet touch:animate-float mouse:sm:animate-pop';
const PANEL_LEAVE = 'animate-sheet-out touch:animate-float-out mouse:sm:animate-pop-out';

/**
 * How wide a dialog may grow in the middle of the screen: `small` for a
 * message, `medium` for a list to choose from, `large` for a form. A sheet
 * on a touch screen is always up to 560 px wide.
 */
export type DialogSize = 'small' | 'medium' | 'large';

const WIDTHS: Record<DialogSize, string> = {
  small: 'max-w-sm',
  medium: 'max-w-md',
  large: 'max-w-lg',
};

/**
 * A modal dialog over the current page. On a touch screen it is a sheet that
 * rises from below the screen and floats above the bottom edge, at most
 * 560 px wide; with a mouse it grows into place in the middle of the screen
 * (from 640 px up; below that it rises from the bottom edge). The backdrop
 * fades in. Focus stays inside while it is open and goes back where it was
 * when it closes. Escape, the backdrop and the × of a closable dialog emit
 * `dismissed`; the owner then sets `open` to false, and the dialog leaves in
 * 150 ms. A dialog opened from inside another one lies over it, and the
 * first one is dimmed by the second one's backdrop.
 *
 * The body is the content; the buttons are the children marked
 * `appDialogAction`, secondary first. Below 640 px they fill the width with
 * the primary one on top; from 640 px they line up on the right.
 */
@Component({
  selector: 'app-dialog',
  imports: [Art, CdkTrapFocus, IconButton, LineIcon],
  template: `
    <ng-template #frame>
      <div
        class="fixed inset-0 flex items-end justify-center mouse:sm:items-center mouse:sm:p-6 {{
          sheetFrame
        }}"
      >
        <div
          aria-hidden="true"
          tabindex="-1"
          class="absolute inset-0 bg-ink/45"
          [class]="layer.leaving() ? 'animate-fade-out' : 'animate-fade'"
          (click)="dismissed.emit()"
        ></div>
        <div
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.aria-labelledby]="titleId"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          class="relative w-full rounded-t-sheet bg-surface p-6 shadow-pop outline-none touch:max-w-sheet touch:rounded-sheet mouse:sm:rounded-sheet"
          [class]="panelClasses()"
          (keydown.escape)="dismissed.emit()"
        >
          <div class="flex items-center gap-3" [class.pr-10]="closable()">
            @if (icon(); as icon) {
              <img alt="" [appArt]="icon" class="size-11" />
            }
            <h2 [id]="titleId" class="text-xl font-black">{{ title() }}</h2>
          </div>
          @if (closable()) {
            <span class="absolute top-3.5 right-3.5">
              <button type="button" appIconButton aria-label="关闭" (click)="dismissed.emit()">
                <app-line-icon name="close" />
              </button>
            </span>
          }
          <ng-content />
          <div class="mt-6 flex flex-col-reverse gap-3 empty:hidden sm:flex-row sm:justify-end">
            <ng-content select="[appDialogAction]" />
          </div>
        </div>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dialog {
  readonly open = input.required<boolean>();
  readonly title = input.required<string>();
  /** The illustrated icon before the title. */
  readonly icon = input<ArtName>();
  readonly size = input<DialogSize>('small');
  /** A dialog that only shows something has a × at its top right instead of actions. */
  readonly closable = input(false);

  readonly dismissed = output();

  protected readonly titleId = `app-dialog-title-${String(nextDialogId++)}`;
  protected readonly sheetFrame = SHEET_FRAME;
  protected readonly layer: Layer;

  protected readonly panelClasses = computed(
    () => `${WIDTHS[this.size()]} ${this.layer.leaving() ? PANEL_LEAVE : PANEL_ENTER}`,
  );

  private readonly frame = viewChild<TemplateRef<unknown>>('frame');

  constructor() {
    const injector = inject(Injector);
    const viewContainer = inject(ViewContainerRef);
    this.layer = new Layer(injector);
    effect(() => {
      const frame = this.frame();
      const open = this.open();
      if (!frame) {
        return;
      }
      untracked(() => {
        if (open) {
          this.layer.show(new TemplatePortal(frame, viewContainer), fullScreenLayer(injector));
        } else {
          this.layer.hide();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.layer.remove();
    });
  }
}
