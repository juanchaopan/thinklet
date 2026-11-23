import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PRESS } from './button';

/**
 * A 44×44 outlined round button holding one of the line icons in the
 * primary colour, such as copying the family code. Screen readers announce
 * `label` as its name, and the element with the id `describedBy`, such as
 * the name of the row the button is in, as its description; with a mouse the
 * label shows as a tooltip under it while it is hovered or has the keyboard
 * focus. Touch screens have no tooltip. The owner listens to the click on
 * the element.
 *
 *   <app-tool-button label="复制家庭码" (click)="copy()"><app-line-icon name="copy" /></app-tool-button>
 */
@Component({
  selector: 'app-tool-button',
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="describedBy()"
      class="group relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-primary hover:bg-canvas {{
        press
      }}"
    >
      <ng-content />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-full left-1/2 z-10 mt-2 hidden -translate-x-1/2 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white opacity-0 shadow-pop transition-opacity duration-100 mouse:block mouse:group-hover:opacity-100 mouse:group-focus-visible:opacity-100"
        >{{ label() }}</span
      >
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolButton {
  readonly label = input.required<string>();
  readonly describedBy = input<string | null>(null);

  protected readonly press = PRESS;
}
