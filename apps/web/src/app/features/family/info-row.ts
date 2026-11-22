import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Art, type IconArt } from '../../shared/ui/art';

/**
 * One fact of the family on its card, such as the family code or the time
 * zone: the illustrated icon, the label in small grey letters, and the
 * content under it.
 */
@Component({
  selector: 'app-info-row',
  imports: [Art],
  host: { class: 'flex gap-4 py-5 first:pt-0 last:pb-0' },
  template: `
    <img alt="" [appArt]="icon()" class="mt-1 size-9" />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-bold text-ink-muted">{{ label() }}</p>
      <div class="mt-1"><ng-content /></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoRow {
  readonly icon = input.required<IconArt>();
  readonly label = input.required<string>();
}
