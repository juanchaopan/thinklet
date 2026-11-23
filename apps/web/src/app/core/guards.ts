import { inject } from '@angular/core';
import { Router, type CanActivateFn, type CanMatchFn } from '@angular/router';
import { CHILD_HOME_PATH, CHILD_LOGIN_PATH, ChildSession } from './child-session';
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
 * keeps the page in `returnTo` so signing in comes back to it; on a browser
 * where only a child is signed in, `/` is the child's home page. While the
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

/** Whether no parent is signed in on this browser. */
async function noParent(): Promise<boolean> {
  return (await inject(Session).ensureLoaded()) === 'visitor';
}

/**
 * `/` is the child's home page on a browser where only a child is signed in
 * (rules.md, 登录和登录状态). The child is asked about only when no parent
 * is signed in, since a signed-in parent sees their own home page.
 */
export const matchChildOnly: CanMatchFn = async () => {
  const childSession = inject(ChildSession);
  return (await noParent()) && (await childSession.ensureLoaded()) === 'signed-in';
};

/** The product home is what a visitor sees at `/`, when neither a parent nor a child is signed in. */
export const matchVisitor: CanMatchFn = () => noParent();

/**
 * The child's home page needs a signed-in child; without one it is the child
 * login. When the child cannot be loaded the page opens and says so, with a
 * retry.
 */
export const requireChild: CanActivateFn = async () => {
  const router = inject(Router);
  const status = await inject(ChildSession).ensureLoaded();
  return status !== 'signed-out' || router.createUrlTree([CHILD_LOGIN_PATH]);
};

/** A child already signed in goes from the child login to the child's home page. */
export const leaveLoginWhenChildIn: CanActivateFn = async () => {
  const router = inject(Router);
  const status = await inject(ChildSession).ensureLoaded();
  return status !== 'signed-in' || router.createUrlTree([CHILD_HOME_PATH]);
};
