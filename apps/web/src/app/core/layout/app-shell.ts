import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  type IsActiveMatchOptions,
} from '@angular/router';
import { Art, Logo, type IconArt } from '../../shared/ui/art';
import { Badge } from '../../shared/ui/card';
import { CurrentFamily } from '../current-family';
import { FamilySwitcher } from './family-switcher';
import { ProfileLink } from './profile-link';

interface NavItem {
  readonly label: string;
  readonly icon: IconArt;
  readonly link: string;
  /** The number of requests waiting, shown as a red count when there are any. */
  readonly count?: number;
}

/**
 * The frame of the signed-in pages. From 1024 px a 256 px sidebar holds the
 * logo mark, the current family and the menu, and the avatar with the name
 * sits at the top right; below that a top bar holds the logo mark, the
 * current family and the avatar, and the menu is a tab bar at the bottom.
 * The menu is 首页 and 家庭管理, plus 新成员 for the family's admin. A parent
 * without a family gets the bare frame instead: the full logo and the avatar,
 * no menus.
 */
@Component({
  selector: 'app-shell',
  imports: [
    Art,
    Badge,
    FamilySwitcher,
    Logo,
    ProfileLink,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  template: `
    @if (navItems(); as items) {
      <div class="min-h-screen lg:flex">
        <aside
          class="hidden w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface/80 px-4 py-5 backdrop-blur lg:flex"
        >
          <div class="px-2"><app-logo [height]="48" [mark]="true" /></div>
          <app-family-switcher />
          <nav aria-label="主菜单" class="flex flex-col gap-1">
            @for (item of items; track item.link) {
              <a
                [routerLink]="item.link"
                routerLinkActive
                #side="routerLinkActive"
                [routerLinkActiveOptions]="samePage"
                ariaCurrentWhenActive="page"
                class="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-bold transition-colors duration-150"
                [class]="side.isActive ? 'bg-tint text-ink' : 'text-ink-soft hover:bg-canvas'"
              >
                <img alt="" [appArt]="item.icon" class="size-8" />
                <span class="flex-1">{{ item.label }}</span>
                @if (item.count) {
                  <span appBadge>{{ item.count }}</span>
                }
              </a>
            }
          </nav>
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <header
            class="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6 lg:justify-end lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none"
          >
            <span class="lg:hidden"><app-logo [height]="38" [mark]="true" /></span>
            <span class="ml-auto lg:hidden"><app-family-switcher [compact]="true" /></span>
            <app-profile-link />
          </header>
          <main class="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:pb-12"><router-outlet /></main>
          <nav
            aria-label="主菜单"
            class="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
            [style.grid-template-columns]="'repeat(' + items.length + ', minmax(0, 1fr))'"
          >
            @for (item of items; track item.link) {
              <a
                [routerLink]="item.link"
                routerLinkActive
                #tab="routerLinkActive"
                [routerLinkActiveOptions]="samePage"
                ariaCurrentWhenActive="page"
                class="relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold"
                [class]="tab.isActive ? 'text-ink' : 'text-ink-muted'"
              >
                <span class="relative">
                  <img alt="" [appArt]="item.icon" class="size-7" />
                  @if (item.count) {
                    <span appBadge class="absolute -top-1.5 -right-3">{{ item.count }}</span>
                  }
                </span>
                {{ item.label }}
              </a>
            }
          </nav>
        </div>
      </div>
    } @else {
      <div class="flex min-h-screen flex-col">
        <header class="flex h-24 items-center px-4 sm:px-8">
          <app-logo [height]="64" />
          <span class="ml-auto"><app-profile-link /></span>
        </header>
        <main class="flex flex-1 flex-col px-4 pb-12 sm:px-8"><router-outlet /></main>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly currentFamily = inject(CurrentFamily);

  /** A menu entry is current on its own page, whatever the query says. */
  protected readonly samePage: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  protected readonly navItems = computed<readonly NavItem[] | null>(() => {
    const family = this.currentFamily.family();
    if (!family) {
      return null;
    }
    const familyPage = `/families/${family.id}`;
    return [
      { label: '首页', icon: 'home', link: '/' },
      { label: '家庭管理', icon: 'settings', link: familyPage },
      ...(family.role === 'admin'
        ? [
            {
              label: '新成员',
              icon: 'letter' as const,
              link: `${familyPage}/new-members`,
              count: family.pendingRequests ?? 0,
            },
          ]
        : []),
    ];
  });
}
