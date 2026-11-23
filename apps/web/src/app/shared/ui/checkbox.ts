import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

let nextCheckboxId = 0;

/**
 * A checkbox with its text, the content; the whole line is the 44 px target.
 * A ticked box is violet like every selection mark. With an `error` the
 * empty box turns red and the message shows under the text, fading in over
 * 200 ms; screen readers hear it with the box.
 *
 *   <app-checkbox [(checked)]="agreed" [error]="error()">我同意…</app-checkbox>
 */
@Component({
  selector: 'app-checkbox',
  host: { class: 'block' },
  template: `
    <label class="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
      <input
        #box
        type="checkbox"
        class="peer sr-only"
        [checked]="checked()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="error() ? errorId : null"
        (change)="checked.set(box.checked)"
      />
      <span
        aria-hidden="true"
        class="mt-px flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors duration-100 peer-focus-visible:ring-2 peer-focus-visible:ring-violet/40"
        [class]="boxClasses()"
      >
        @if (checked()) {
          <svg class="size-4" viewBox="0 0 20 20">
            <path
              d="m4.5 10.5 3.6 3.4L15.5 6.5"
              stroke="currentColor"
              stroke-width="3"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        }
      </span>
      <span class="text-base leading-6"><ng-content /></span>
    </label>
    @if (error(); as message) {
      <p [id]="errorId" class="animate-fade pl-9 text-sm font-bold text-rose-ink">{{ message }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkbox {
  readonly checked = model(false);
  readonly error = input<string | null>(null);

  protected readonly errorId = `app-checkbox-error-${String(nextCheckboxId++)}`;

  /** Ticked, empty with an error, or empty. */
  protected readonly boxClasses = computed(() => {
    if (this.checked()) {
      return 'border-violet bg-violet text-white';
    }
    return this.error() ? 'border-rose-ink bg-rose/40' : 'border-line-strong bg-surface';
  });
}
