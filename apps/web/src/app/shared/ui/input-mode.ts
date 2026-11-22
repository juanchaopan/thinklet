import { DOCUMENT, Injectable, inject, signal, type Signal } from '@angular/core';

/**
 * The primary input device and the width class, as signals that follow the
 * browser. Dialogs, menus and editing pick the finger or mouse version from
 * `touch` (CSS `pointer: coarse`), the same switch as the `touch:` and
 * `mouse:` style variants; the navigation picks its layout from `wide`.
 */
@Injectable({ providedIn: 'root' })
export class InputMode {
  private readonly window = inject(DOCUMENT).defaultView;

  /** The primary pointer is a finger. */
  readonly touch = this.media('(pointer: coarse)');

  /** The screen is at least 1024 px wide, where the sidebar is shown. */
  readonly wide = this.media('(min-width: 1024px)');

  private media(query: string): Signal<boolean> {
    const list = this.window?.matchMedia(query);
    const matches = signal(list?.matches ?? false);
    list?.addEventListener('change', (event) => matches.set(event.matches));
    return matches.asReadonly();
  }
}
