import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Art } from '../../shared/ui/art';
import { Chip } from '../../shared/ui/card';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { CurrentFamily } from '../current-family';
import { Session } from '../session';

/**
 * The current family in the navigation; it opens the menu of the parent's
 * families to switch between them. In the sidebar it says 切换家庭 under the
 * name and, with a mouse, its menu drops down; in the narrow top bar it shows
 * the name alone and its menu rises from the bottom.
 */
@Component({
  selector: 'app-family-switcher',
  imports: [Art, Chip, LineIcon, Menu, MenuItem],
  template: `
    @if (currentFamily.family(); as family) {
      <button
        #trigger
        type="button"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        class="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 text-left hover:bg-canvas"
        [class.max-w-44]="compact()"
        (click)="open.set(true)"
      >
        <img alt="" appArt="family" class="size-7" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-bold text-ink">{{ family.name }}</span>
          @if (compact()) {
            <span class="sr-only">切换家庭</span>
          } @else {
            <span class="block text-xs text-ink-muted">切换家庭</span>
          }
        </span>
        <app-line-icon name="chevron" class="text-ink-muted" />
      </button>
      <app-menu
        [open]="open()"
        label="切换家庭"
        [origin]="trigger"
        [dropDown]="dropDown()"
        (dismissed)="open.set(false)"
      >
        @for (item of families(); track item.id) {
          <button
            type="button"
            appMenuItem
            [current]="item.id === family.id"
            [attr.aria-current]="item.id === family.id ? 'true' : null"
            (click)="choose(item.id)"
          >
            <img alt="" appArt="family" class="size-7" />
            <span class="flex-1 font-bold">{{ item.name }}</span>
            @if (item.role === 'admin') {
              <span appChip="sun">管理员</span>
            }
            @if (item.id === family.id) {
              <app-line-icon name="check" class="text-violet" />
            }
          </button>
        }
      </app-menu>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilySwitcher {
  /** The top bar's version: the name alone, at most 176 px wide. */
  readonly compact = input(false);

  protected readonly currentFamily = inject(CurrentFamily);
  protected readonly open = signal(false);
  private readonly session = inject(Session);
  protected readonly families = computed(() => this.session.me()?.families ?? []);

  private readonly inputMode = inject(InputMode);
  private readonly router = inject(Router);

  protected readonly dropDown = computed(() => !this.compact() && !this.inputMode.touch());

  /**
   * Makes the family current. On a page of the previous family the same page
   * of the chosen family opens.
   */
  protected choose(familyId: string): void {
    const previous = this.currentFamily.family()?.id;
    this.open.set(false);
    this.currentFamily.select(familyId);
    const prefix = `/families/${previous ?? ''}`;
    const url = this.router.url;
    if (previous && (url === prefix || url.startsWith(`${prefix}/`))) {
      void this.router.navigateByUrl(`/families/${familyId}${url.slice(prefix.length)}`);
    }
  }
}
