import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Logo } from '../../shared/ui/art';

/**
 * The frame of the pages a visitor sees before signing in (the product home,
 * the child login): only the full logo at the top, 72 px high, no menus.
 */
@Component({
  selector: 'app-public-layout',
  imports: [Logo],
  host: { class: 'flex min-h-screen flex-col' },
  template: `
    <header class="flex h-24 items-center px-5 sm:px-8"><app-logo [height]="72" /></header>
    <main class="flex flex-1 flex-col"><ng-content /></main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicLayout {}
