import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Art } from '../../shared/ui/art';
import { Chip } from '../../shared/ui/card';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Menu, MenuDivider, MenuItem } from '../../shared/ui/menu';
import { CurrentFamily, pageAfterSwitch } from '../current-family';
import { FamilyCreation } from '../family-creation';
import { Session } from '../session';

/**
 * The current family in the navigation; it opens the menu of the parent's
 * families, in the order they joined them with the current one ticked, and
 * 创建家庭 under them. In the sidebar it says 切换家庭 under the name and,
 * with a mouse, its menu drops down; in the narrow top bar it shows the name
 * alone and its menu rises from the bottom.
 */
@Component({
  selector: 'app-family-switcher',
  imports: [Art, Chip, LineIcon, Menu, MenuDivider, MenuItem],
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
        <div appMenuDivider></div>
        <button type="button" appMenuItem (click)="create()">
          <img alt="" appArt="seedling" class="size-7" />
          <span class="font-bold">创建家庭</span>
        </button>
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
  private readonly creation = inject(FamilyCreation);

  protected readonly dropDown = computed(() => !this.compact() && !this.inputMode.touch());

  /**
   * Makes the family current and opens the page the rules give for the page
   * the parent is on (rules.md, 导航); the counts and red dots are read again
   * for the new family.
   */
  protected choose(familyId: string): void {
    this.open.set(false);
    const next = this.families().find((family) => family.id === familyId);
    if (!next || next.id === this.currentFamily.family()?.id) {
      return;
    }
    this.currentFamily.select(next.id);
    const page = pageAfterSwitch(this.router.url, next);
    if (page) {
      void this.router.navigateByUrl(page);
    } else {
      void this.session.refresh();
    }
  }

  /** Asks for the dialog that creates a family, over the page the parent is on. */
  protected create(): void {
    this.open.set(false);
    this.creation.request();
  }
}
