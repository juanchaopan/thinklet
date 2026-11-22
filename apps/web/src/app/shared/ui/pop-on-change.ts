import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { restartAnimation } from './restart-animation';

/**
 * Plays the count's pop, growing to 120% and back in 200 ms, each time the
 * bound value changes after it is first shown, as the number of waiting
 * requests does when the admin handles one. Showing the first value plays
 * nothing, so a page that opens does not pop its counts.
 *
 *   <span appBadge [appPopOnChange]="count">{{ count }}</span>
 */
@Directive({ selector: '[appPopOnChange]' })
export class PopOnChange {
  readonly appPopOnChange = input.required<unknown>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let shown = false;
    effect(() => {
      this.appPopOnChange();
      if (!shown) {
        shown = true;
        return;
      }
      restartAnimation(element, 'animate-count');
    });
  }
}
