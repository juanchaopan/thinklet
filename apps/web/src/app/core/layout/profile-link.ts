import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Avatar } from '../../shared/ui/avatar';
import { CurrentFamily } from '../current-family';
import { Session } from '../session';

/**
 * The parent's own avatar at the top right, with the name from 1024 px up.
 * It opens the profile page and is shown as current there. Screen readers
 * hear the name where it is shown, then 个人设置.
 */
@Component({
  selector: 'app-profile-link',
  imports: [Avatar, RouterLink, RouterLinkActive],
  template: `
    @if (session.me(); as me) {
      <a
        routerLink="/profile"
        routerLinkActive
        #link="routerLinkActive"
        ariaCurrentWhenActive="page"
        class="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-1 lg:pr-3"
        [class]="link.isActive ? 'bg-tint' : 'hover:bg-surface/70'"
      >
        <app-avatar [name]="me.name" [colorIndex]="currentFamily.ownPlace()" />
        <span class="hidden text-sm font-bold lg:inline">{{ me.name }}</span>
        <span class="sr-only">个人设置</span>
      </a>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileLink {
  protected readonly session = inject(Session);
  protected readonly currentFamily = inject(CurrentFamily);
}
