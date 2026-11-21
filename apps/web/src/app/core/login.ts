import { DOCUMENT, Injectable, inject } from '@angular/core';

/** Where signing in starts: the api sends the browser on to the hosted login page. */
const LOGIN_PATH = '/api/auth/login';

/**
 * The path to come back to after signing in, if it is one of this site's
 * own paths: it starts with a single `/`, never `//` or `/\` (which browsers
 * read as another host). Anything else is dropped.
 */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return undefined;
  }
  return value;
}

/** The address that starts signing in and comes back to `returnTo` afterwards. */
export function loginUrl(returnTo?: string | null): string {
  const path = safeReturnTo(returnTo);
  return path ? `${LOGIN_PATH}?returnTo=${encodeURIComponent(path)}` : LOGIN_PATH;
}

/**
 * Full-page navigation, for the addresses outside the single-page app:
 * signing in and out go through the api and the hosted login page, which a
 * router navigation cannot reach.
 */
@Injectable({ providedIn: 'root' })
export class PageNavigation {
  private readonly document = inject(DOCUMENT);

  go(url: string): void {
    this.document.location.assign(url);
  }
}
