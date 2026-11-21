import { inject } from '@angular/core';
import { Router, type CanActivateFn, type CanMatchFn } from '@angular/router';
import { Session } from './session';

/**
 * Pages for signed-in parents. A visitor goes to the product home, which
 * keeps the page in `returnTo` so signing in comes back to it. While the
 * parent cannot be loaded the navigation stops and the page is kept for the
 * retry (the app shows the failure).
 */
export const requireParent: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const session = inject(Session);
  const status = await session.ensureLoaded();
  if (status === 'signed-in') {
    return true;
  }
  if (status === 'visitor') {
    return router.createUrlTree(['/'], { queryParams: { returnTo: state.url } });
  }
  session.keepForRetry(state.url);
  return false;
};

/** Pages inside a family; a parent without a family goes to the start page. */
export const requireFamily: CanActivateFn = () => {
  const families = inject(Session).me()?.families ?? [];
  return families.length > 0 || inject(Router).createUrlTree(['/start']);
};

/** The product home is what a visitor sees at `/`. */
export const matchVisitor: CanMatchFn = async () =>
  (await inject(Session).ensureLoaded()) === 'visitor';
