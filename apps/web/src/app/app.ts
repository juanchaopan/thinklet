import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Connectivity } from './core/connectivity';
import { PublicLayout } from './core/layout/public-layout';
import { Session } from './core/session';
import { PageProblem } from './shared/ui/page-problem';
import { ToastOutlet } from './shared/ui/toast';

/**
 * The application shell: every page is rendered by the router into it, and
 * toasts appear above them. When the signed-in parent cannot be loaded at
 * all, the page cannot know what to show, so it says so with the error id
 * and a retry instead.
 */
@Component({
  selector: 'app-root',
  imports: [PageProblem, PublicLayout, RouterOutlet, ToastOutlet],
  template: `
    @if (session.status() === 'failed') {
      <app-public-layout>
        <div class="px-5 sm:px-8">
          <app-page-problem
            kind="server"
            [requestId]="session.failure()?.requestId"
            (action)="session.retry()"
          />
        </div>
      </app-public-layout>
    } @else {
      <router-outlet />
    }
    <app-toast-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly session = inject(Session);

  constructor() {
    inject(Connectivity).start();
  }
}
