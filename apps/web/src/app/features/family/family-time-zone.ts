import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TIME_ZONE_HINT } from '../../core/create-family-dialog';
import { IconButton, PRESS } from '../../shared/ui/button';
import { EditActions } from '../../shared/ui/edit-field';
import { LineIcon } from '../../shared/ui/line-icon';
import { TimeZoneField } from '../../shared/ui/time-zone-picker';
import {
  BrowserTimeZone,
  canonicalTimeZone,
  timeZoneLabel,
  timeZoneOption,
} from '../../shared/ui/time-zones';
import { FamilyStore } from './family-store';

/**
 * The family's time zone, as "Asia/Shanghai（UTC+08:00）" (rules.md, 家庭).
 * The admin changes it with the pencil, in place: the zone becomes the
 * field that opens the time zone list (in the middle of the screen with a
 * mouse, rising from the bottom on a touch screen) with 取消 and 保存.
 *
 * Where the browser reports a zone other than the family's, compared by
 * their standard names, the admin sees it under the family's zone, rising
 * into place, with 改成这个, which saves it; other parents never do.
 */
@Component({
  selector: 'app-family-time-zone',
  imports: [EditActions, IconButton, LineIcon, TimeZoneField],
  host: { class: 'block' },
  template: `
    @if (editing() && store.admin()) {
      <form
        class="flex animate-fade flex-col gap-3 sm:flex-row"
        [class]="error() ? 'sm:items-start' : 'sm:items-center'"
        (submit)="save($event)"
        (keydown.escape)="stop()"
      >
        <app-time-zone-field
          class="flex-1"
          [showLabel]="false"
          [autofocus]="true"
          [value]="draft()"
          (valueChange)="choose($event)"
          [error]="error()"
        />
        <app-edit-actions
          [saving]="store.busy() === 'timezone'"
          [raised]="error() !== null"
          (cancelled)="stop()"
        />
      </form>
    } @else {
      <div class="flex items-center gap-1">
        <p class="text-base font-bold">{{ shown() }}</p>
        @if (store.admin()) {
          <button type="button" appIconButton aria-label="改时区" (click)="start()">
            <app-line-icon name="pencil" />
          </button>
        }
      </div>
      @if (here(); as zone) {
        <div
          class="mt-2 flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sun px-4 py-2.5 text-sm text-sun-ink"
        >
          <span class="flex-1 basis-40">当前位置：{{ zone.label }}</span>
          <button
            type="button"
            class="min-h-11 rounded-full bg-surface px-4 font-bold text-ink shadow-card {{ press }}"
            [disabled]="store.busy() !== null"
            (click)="useHere(zone.id)"
          >
            改成这个
          </button>
        </div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyTimeZone {
  protected readonly store = inject(FamilyStore);
  protected readonly press = PRESS;

  protected readonly editing = signal(false);
  protected readonly draft = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Where the browser is, by the standard name of its zone; null when it does not say. */
  private readonly browserZone = inject(BrowserTimeZone).current();

  /** The family's zone by its standard name, which is how it is shown and compared. */
  private readonly familyZone = computed(() => {
    const zone = this.store.family()?.timezone ?? '';
    return canonicalTimeZone(zone) ?? zone;
  });

  protected readonly shown = computed(() => timeZoneLabel(this.familyZone()));

  /** The browser's zone, for the admin, when it is not the family's. */
  protected readonly here = computed(() => {
    const zone = this.browserZone;
    if (!this.store.admin() || !zone || zone === this.familyZone()) {
      return null;
    }
    return timeZoneOption(zone, new Date());
  });

  protected start(): void {
    this.draft.set(this.familyZone());
    this.error.set(null);
    this.editing.set(true);
  }

  protected stop(): void {
    this.editing.set(false);
  }

  protected choose(zone: string | null): void {
    this.draft.set(zone);
    this.error.set(null);
  }

  /** Saves the chosen zone; without one it says 请选择时区 and sends nothing. */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const timezone = this.draft();
    if (!timezone) {
      this.error.set(TIME_ZONE_HINT);
      return;
    }
    const result = await this.store.update({ timezone });
    if (result.outcome === 'saved') {
      this.editing.set(false);
    } else if (result.outcome === 'rejected') {
      this.error.set(TIME_ZONE_HINT);
    }
  }

  protected async useHere(timezone: string): Promise<void> {
    await this.store.update({ timezone });
  }
}
