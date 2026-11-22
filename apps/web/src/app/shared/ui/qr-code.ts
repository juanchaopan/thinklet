import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { create } from 'qrcode';

/** The standard quiet zone around a QR code, in modules. */
const QUIET_ZONE = 4;

/** One run of dark modules in a row of the code, as an SVG rectangle in module units. */
interface DarkRun {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/**
 * The dark modules of the QR code for `text`, row by row, with each run of
 * neighbouring dark modules in a row joined into one rectangle so the
 * drawing stays small. Positions include the quiet zone.
 */
export function darkRuns(text: string): { readonly span: number; readonly runs: DarkRun[] } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const runs: DarkRun[] = [];
  for (let y = 0; y < modules.size; y++) {
    let x = 0;
    while (x < modules.size) {
      if (!modules.get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < modules.size && modules.get(y, x)) {
        x++;
      }
      runs.push({ x: start + QUIET_ZONE, y: y + QUIET_ZONE, width: x - start });
    }
  }
  return { span: modules.size + QUIET_ZONE * 2, runs };
}

/**
 * A QR code of `text`, drawn by the template as an SVG with crisp square
 * modules (decision 0032): the `qrcode` library only works out the modules,
 * so no image address or HTML string is put into the page. Each module is
 * `modulePixels` CSS pixels; `label` is what screen readers say it is.
 */
@Component({
  selector: 'app-qr-code',
  host: { class: 'block' },
  template: `
    <svg
      role="img"
      [attr.aria-label]="label()"
      [attr.width]="pixels()"
      [attr.height]="pixels()"
      [attr.viewBox]="'0 0 ' + code().span + ' ' + code().span"
      shape-rendering="crispEdges"
      class="block"
    >
      <rect [attr.width]="code().span" [attr.height]="code().span" class="fill-surface" />
      <g class="fill-ink">
        @for (run of code().runs; track $index) {
          <rect [attr.x]="run.x" [attr.y]="run.y" [attr.width]="run.width" height="1" />
        }
      </g>
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrCode {
  readonly text = input.required<string>();
  readonly label = input.required<string>();
  readonly modulePixels = input(6);

  protected readonly code = computed(() => darkRuns(this.text()));
  protected readonly pixels = computed(() => this.code().span * this.modulePixels());
}
