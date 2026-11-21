import { DOCUMENT, Injectable, computed, inject, resource, signal } from '@angular/core';
import { familyDetailSchema, type MeFamily } from '@thinklet/contracts';
import { Api } from './api';
import { Session } from './session';

/** The browser's local storage key for the family used last on this browser. */
const STORAGE_KEY = 'thinklet.currentFamilyId';

/**
 * The family the parent is working in. It is the family used last on this
 * browser (kept in local storage); without one, or when the parent is no
 * longer its member, it is the family they joined first. Null while the
 * parent has no family.
 */
@Injectable({ providedIn: 'root' })
export class CurrentFamily {
  private readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;

  private readonly chosenId = signal(this.read());

  readonly family = computed<MeFamily | null>(() => {
    const families = this.session.me()?.families ?? [];
    return families.find((family) => family.id === this.chosenId()) ?? families.at(0) ?? null;
  });

  /** The current family as its members see it (`GET /api/families/{familyId}`). */
  readonly detail = resource({
    params: () => this.family()?.id,
    loader: ({ params: familyId }) => this.api.get(`/api/families/${familyId}`, familyDetailSchema),
  });

  /** Where the signed-in parent stands in the family's member list; 0 until it is known. */
  readonly ownPlace = computed(() => {
    const members = this.detail.hasValue() ? this.detail.value().members : [];
    return Math.max(
      members.findIndex((member) => member.you),
      0,
    );
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
