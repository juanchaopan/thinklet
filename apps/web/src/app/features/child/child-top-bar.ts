import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SignedInChild } from '@thinklet/contracts';
import { CHILD_PROFILE_PATH } from '../../core/child-session';
import { Logo } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';

/**
 * The light top bar of the signed-in child's pages (look.md, 布局): the full
 * logo at the left and, at the right, the child's avatar, with the nickname
 * from 1024 px, which opens the child's own settings. On the settings page
 * it is the current page: tinted, and marked as such for screen readers.
 *
 * Screen readers hear "<nickname>的个人设置". The nickname is part of that
 * text, the part shown from 1024 px, so what is seen is always part of what
 * is heard, as with the parent's avatar.
 */
@Component({
  selector: 'app-child-top-bar',
  imports: [Avatar, Logo, RouterLink],
  template: `
    <header
      class="flex h-20 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:h-24 sm:px-8"
    >
      <app-logo [height]="56" />
      <a
        [routerLink]="profilePath"
        [attr.aria-current]="current() ? 'page' : null"
        class="ml-auto flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-1 lg:pr-4"
        [class]="current() ? 'bg-tint' : 'hover:bg-surface/70'"
      >
        <app-avatar [name]="child().nickname" [personId]="child().id" size="bar" />
        <span class="sr-only text-lg font-black lg:not-sr-only">{{ child().nickname }}</span><span
          class="sr-only"
          >的个人设置</span
        >
      </a>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildTopBar {
  readonly child = input.required<SignedInChild>();
  /** Whether the page is the child's own settings, which the avatar opens. */
  readonly current = input(false);

  protected readonly profilePath = CHILD_PROFILE_PATH;
}
