/**
 * Plays the animation of a Tailwind `animate-*` class on the element from
 * its start, even when the class is on the element already, as for a box
 * that shakes again on each new failed attempt.
 */
export function restartAnimation(element: HTMLElement, animation: string): void {
  element.classList.remove(animation);
  // Reading the layout restarts the animation when the class comes back.
  element.getBoundingClientRect();
  element.classList.add(animation);
}
