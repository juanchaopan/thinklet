import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/**
 * Says whether the element is on the screen: `inView` emits true when it
 * comes into view, as the end of a list does when the page is scrolled to
 * the bottom, and false when it leaves. It also emits once as soon as the
 * element is shown, so an element already on the screen is seen at once.
 */
@Directive({ selector: '[appInView]' })
export class InView {
  readonly inView = output<boolean>();

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.inView.emit(entry.isIntersecting);
      }
    });
    observer.observe(element);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
    });
  }
}
