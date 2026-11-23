import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  type IsActiveMatchOptions,
} from '@angular/router';
import { Art, Logo, type IconArt } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Badge, Dot } from '../../shared/ui/card';
import { PopOnChange } from '../../shared/ui/pop-on-change';
import { CreateFamilyDialog } from '../create-family-dialog';
import { CurrentFamily } from '../current-family';
import { FamilyCreation } from '../family-creation';
import { Session } from '../session';
import { FamilySwitcher } from './family-switcher';
import { PARENT_PAGES } from './parent-pages';
import { UserMenu } from './user-menu';

/** The most waiting requests a badge writes out; more read "99+" (rules.md, 通知). */
const MOST_COUNTED = 99;

/** A count as its badge shows it: the number up to 99, then "99+". */
export function countText(count: number): string {
  return count > MOST_COUNTED ? `${String(MOST_COUNTED)}+` : String(count);
}

interface NavItem {
  readonly label: string;
  readonly icon: IconArt;
  readonly link: string;
  /** The number of requests waiting, shown as a red count when there are any. */
  readonly count?: number;
}

/**
 * The frame of the signed-in pages (look.md, 布局). The navigation has two
 * parts: the current family's pages (首页, 孩子 and 家庭管理 for every parent
 * of the family, and 新成员 for its admin) under the family switcher, and
 * the parent's own pages (加入家庭, 个人设置) under the parent's avatar and
 * name.
 *
 * From 1024 px a 256 px sidebar holds the logo mark, the family switcher,
 * the family's pages and, under a line, the parent's group; there is no bar
 * above the content. Below that a top bar holds the logo mark, the family
 * switcher and the avatar, which opens the parent's menu, and the family's
 * pages are a tab bar at the bottom. A parent without a family gets the bare
 * frame instead: the full logo and the avatar with its menu, no family pages.
 *
 * The count on 新成员 reads "99+" past 99, and pops each time it changes, as
 * when the admin handles a request.
 *
 * The dialog that creates a family belongs to the frame, so it can open over
 * any signed-in page. Its code is loaded the first time it is asked for, so
 * the pages that never create a family do not wait for it.
 */
@Component({
  selector: 'app-shell',
  imports: [
    Art,
    Avatar,
    Badge,
    CreateFamilyDialog,
    Dot,
    FamilySwitcher,
    Logo,
    PopOnChange,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    UserMenu,
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
                  <span appBadge [appPopOnChange]="item.count">{{ countText(item.count) }}</span>
                }
              </a>
            }
          </nav>
          @if (session.me(); as me) {
            <nav [attr.aria-label]="me.name" class="flex flex-col gap-1 border-t border-line pt-5">
              <div class="flex min-h-12 items-center gap-3 px-3">
                <app-avatar [name]="me.name" [personId]="me.id" size="small" />
                <span class="font-bold">{{ me.name }}</span>
              </div>
              @for (page of parentPages; track page.link) {
                <a
                  [routerLink]="page.link"
                  routerLinkActive
                  #own="routerLinkActive"
                  [routerLinkActiveOptions]="samePage"
                  ariaCurrentWhenActive="page"
                  class="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-bold transition-colors duration-150"
                  [class]="own.isActive ? 'bg-tint text-ink' : 'text-ink-soft hover:bg-canvas'"
                >
                  <img alt="" [appArt]="page.icon" class="size-8" />
                  <span class="flex-1">{{ page.label }}</span>
                  @if (page.showsRequestResults && me.requestResults > 0) {
                    <span appDot class="mr-1.5"></span>
                    <span class="sr-only">，有新的申请结果</span>
                  }
                </a>
              }
            </nav>
          }
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <header
            class="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6 lg:hidden"
          >
            <app-logo [height]="38" [mark]="true" />
            <span class="ml-auto"><app-family-switcher [compact]="true" /></span>
            <app-user-menu />
          </header>
          <main class="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:pt-20 lg:pb-12">
            <router-outlet />
          </main>
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
                    <span
                      appBadge
                      [appPopOnChange]="item.count"
                      class="absolute -top-1.5 -right-3"
                      >{{ countText(item.count) }}</span
                    >
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
          <span class="ml-auto"><app-user-menu [markCurrent]="false" /></span>
        </header>
        <main class="flex flex-1 flex-col px-4 pb-12 sm:px-8"><router-outlet /></main>
      </div>
    }
    @defer (when creation.requested()) {
      <app-create-family-dialog />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly session = inject(Session);
  protected readonly creation = inject(FamilyCreation);
  private readonly currentFamily = inject(CurrentFamily);

  protected readonly parentPages = PARENT_PAGES;
  protected readonly countText = countText;

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
      { label: '孩子', icon: 'child', link: `${familyPage}/children` },
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
