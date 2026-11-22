import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { Art } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Dot } from '../../shared/ui/card';
import { InputMode } from '../../shared/ui/input-mode';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Session } from '../session';
import { PARENT_PAGES } from './parent-pages';

/**
 * The parent's own avatar at the right of the top bar (with the name from
 * 1024 px, where only the frame without a family shows it). It opens the
 * parent's menu, headed by the avatar and the name: 加入家庭 and 个人设置. A
 * red dot on the avatar and on 加入家庭 tells of request results not yet
 * seen. On a touch screen the menu is a floating sheet; with a mouse it
 * drops down from the avatar. In the top bar of the family frame the avatar
 * is shown as the current one on the pages of its menu.
 *
 * Screen readers hear "<name>的菜单", and of the results not yet seen. The
 * name is part of that text, the part shown from 1024 px, so what is seen is
 * always part of what is heard.
 */
@Component({
  selector: 'app-user-menu',
  imports: [Art, Avatar, Dot, Menu, MenuItem, RouterLink],
  template: `
    @if (session.me(); as me) {
      <button
        #trigger
        type="button"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        class="relative flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-1 lg:pr-3"
        [class]="markCurrent() && onOwnPage() ? 'bg-tint' : 'hover:bg-surface/70'"
        (click)="open.set(true)"
      >
        <app-avatar [name]="me.name" [parentId]="me.id" />
        <span class="sr-only text-sm font-bold lg:not-sr-only">{{ me.name }}</span><span
          class="sr-only"
          >的菜单</span
        >
        @if (news()) {
          <span class="sr-only">，有新的申请结果</span>
          <span
            aria-hidden="true"
            class="absolute top-0.5 left-[1.875rem] size-3 rounded-full border-2 border-surface bg-badge"
          ></span>
        }
      </button>
      <app-menu
        [open]="open()"
        [label]="me.name"
        [origin]="trigger"
        [dropDown]="!inputMode.touch()"
        align="end"
        (dismissed)="open.set(false)"
      >
        <div aria-hidden="true" class="flex items-center gap-3 px-3 py-3">
          <app-avatar [name]="me.name" [parentId]="me.id" size="large" />
          <p class="font-bold">{{ me.name }}</p>
        </div>
        <div role="separator" class="my-1 border-t border-line"></div>
        @for (page of pages; track page.link) {
          <a
            appMenuItem
            [routerLink]="page.link"
            [current]="path() === page.link"
            (click)="open.set(false)"
          >
            <img alt="" [appArt]="page.icon" class="size-7" />
            <span class="flex-1 font-bold">{{ page.label }}</span>
            @if (page.link === '/join' && news()) {
              <span appDot></span><span class="sr-only">，有新的申请结果</span>
            }
          </a>
        }
      </app-menu>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserMenu {
  /**
   * Whether the avatar is shown as current on the pages of its menu. The
   * frame without a family leaves it plain, as the design draws it.
   */
  readonly markCurrent = input(true);

  protected readonly session = inject(Session);
  protected readonly inputMode = inject(InputMode);
  protected readonly open = signal(false);
  protected readonly pages = PARENT_PAGES;

  private readonly router = inject(Router);

  /** The path of the page now open, without its query. */
  protected readonly path = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.currentPath()),
    ),
    { initialValue: this.currentPath() },
  );

  protected readonly onOwnPage = computed(() =>
    this.pages.some((page) => page.link === this.path()),
  );

  /** Whether request results wait to be seen. */
  protected readonly news = computed(() => (this.session.me()?.requestResults ?? 0) > 0);

  private currentPath(): string {
    return this.router.url.split(/[?#]/)[0] ?? '/';
  }
}
