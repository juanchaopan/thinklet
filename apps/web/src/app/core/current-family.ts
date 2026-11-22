import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import type { MeFamily } from '@thinklet/contracts';
import { Session } from './session';

/** The browser's local storage key for the family used last on this browser. */
const STORAGE_KEY = 'thinklet.currentFamilyId';

/** A family's own pages: its family page and its new members page. */
const FAMILY_PAGE = /^\/families\/[^/?#]+(\/new-members)?(?:[?#].*)?$/;

/**
 * Where the parent goes after switching to the family `next` while on `url`
 * (rules.md, 导航): from a family page to the new family's family page; from
 * a new members page to the new family's new members page when they are its
 * admin, else to its family page. Null on every other page (the home page,
 * the join page, the profile), which stays and shows the new family.
 */
export function pageAfterSwitch(url: string, next: MeFamily): string | null {
  const match = FAMILY_PAGE.exec(url);
  if (!match) {
    return null;
  }
  const newMembers = match[1] === '/new-members' && next.role === 'admin';
  return `/families/${next.id}${newMembers ? '/new-members' : ''}`;
}

/**
 * The family the parent is working in. It is the family used last on this
 * browser (kept in local storage); without one, or when the parent is no
 * longer its member, it is the family they joined first. Null while the
 * parent has no family.
 */
@Injectable({ providedIn: 'root' })
export class CurrentFamily {
  private readonly session = inject(Session);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;

  private readonly chosenId = signal(this.read());

  readonly family = computed<MeFamily | null>(() => {
    const families = this.session.me()?.families ?? [];
    return families.find((family) => family.id === this.chosenId()) ?? families.at(0) ?? null;
  });

  /** Makes the family current and remembers it on this browser. */
  select(familyId: string): void {
    this.chosenId.set(familyId);
    try {
      this.storage?.setItem(STORAGE_KEY, familyId);
    } catch {
      // Storage can be full or blocked; the choice then lasts for this visit.
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
