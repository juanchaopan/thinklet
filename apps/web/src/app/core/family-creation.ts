import { Injectable, signal } from '@angular/core';

/**
 * Where creating a family is asked for. The family menu (and the start page)
 * ask with `request`; the create dialog opens while `requested` is true and
 * calls `done` when it closes.
 */
@Injectable({ providedIn: 'root' })
export class FamilyCreation {
  private readonly asked = signal(false);

  readonly requested = this.asked.asReadonly();

  request(): void {
    this.asked.set(true);
  }

  done(): void {
    this.asked.set(false);
  }
}
