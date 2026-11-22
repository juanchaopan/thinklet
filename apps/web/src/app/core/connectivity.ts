import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, skip } from 'rxjs';
import { Toaster } from '../shared/ui/toast';
import { Session } from './session';

/**
 * Runs `callback` whenever the browser window comes back to the front, until
 * whatever called this (a page, a service) is destroyed. Call it where
 * `inject` works, such as a constructor.
 */
export function whenBackInFront(callback: () => void): void {
  const document = inject(DOCUMENT);
  const visible = () => {
    if (document.visibilityState === 'visible') {
      callback();
    }
  };
  document.addEventListener('visibilitychange', visible);
  inject(DestroyRef).onDestroy(() => {
    document.removeEventListener('visibilitychange', visible);
  });
}

/**
 * Keeps the app in step with the world outside the page: losing the network
 * shows the 网络断开了 toast, and the signed-in parent (their families and
 * the number of waiting requests) is fetched again whenever another page
 * opens or the browser window comes back to the front.
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly document = inject(DOCUMENT);
  private readonly toaster = inject(Toaster);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    whenBackInFront(() => void this.session.refresh());
  }

  start(): void {
    const window = this.document.defaultView;
    const offline = () => {
      this.toaster.show('网络断开了，请稍后再试', 'error', 'wrench');
    };
    window?.addEventListener('offline', offline);
    const navigations = this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        skip(1),
      )
      .subscribe(() => void this.session.refresh());
    this.destroyRef.onDestroy(() => {
      window?.removeEventListener('offline', offline);
      navigations.unsubscribe();
    });
  }
}
