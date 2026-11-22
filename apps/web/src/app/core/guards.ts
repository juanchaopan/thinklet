import { inject } from '@angular/core';
import { Router, type CanActivateFn, type CanMatchFn } from '@angular/router';
import { CurrentFamily } from './current-family';
import { Session } from './session';

/** The route parameter that names a family in the address, as in `/families/:familyId`. */
export const FAMILY_ID_PARAMETER = 'familyId';

/** The signed-in parent's families, once the parent is loaded. */
async function ownFamilies() {
  const session = inject(Session);
  await session.ensureLoaded();
  return session.me()?.families ?? [];
}

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
export const requireFamily: CanActivateFn = async () => {
  const router = inject(Router);
  return (await ownFamilies()).length > 0 || router.createUrlTree(['/start']);
};

/** The start page is for a parent without a family; one with a family goes to the home page. */
export const requireNoFamily: CanActivateFn = async () => {
  const router = inject(Router);
  return (await ownFamilies()).length === 0 || router.createUrlTree(['/']);
};

/**
 * Matches the version of an address meant for a parent with a family, such
 * as an invitation link, which opens over the join page for them and over
 * the start page for a parent without one.
 */
export const matchFamily: CanMatchFn = async () => (await ownFamilies()).length > 0;

/**
 * A family page opened from its address makes that family the current one
 * (rules.md, 导航). A family the parent is not a member of changes nothing;
 * its page says the family is not there.
 */
export const makeFamilyCurrent: CanActivateFn = async (route) => {
  const currentFamily = inject(CurrentFamily);
  const familyId = route.paramMap.get(FAMILY_ID_PARAMETER);
  const families = await ownFamilies();
  if (familyId && families.some((family) => family.id === familyId)) {
    currentFamily.select(familyId);
  }
  return true;
};

/**
 * Pages only the family's admin sees. A member who is not the admin goes
 * straight to the family's page, without a word (rules.md, 导航); for a
 * family the parent is not in, the page itself says the family is not there.
 */
export const requireFamilyAdmin: CanActivateFn = async (route) => {
  const router = inject(Router);
  const familyId = route.paramMap.get(FAMILY_ID_PARAMETER);
  const family = (await ownFamilies()).find((own) => own.id === familyId);
  return family?.role !== 'member' || router.createUrlTree(['/families', family.id]);
};

/** The product home is what a visitor sees at `/`. */
export const matchVisitor: CanMatchFn = async () =>
  (await inject(Session).ensureLoaded()) === 'visitor';
