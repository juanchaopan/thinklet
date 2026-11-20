/**
 * Holds every animation under `root` at `time` milliseconds from its start,
 * so a screenshot can show one chosen frame of it. This covers CSS
 * animations, CSS transitions and `element.animate()`, which all appear in
 * the Web Animations API: each one is paused and moved to that moment.
 *
 * Trigger the animation first, then call this, then take the screenshot with
 * `heldAnimations: true` so the frame is kept instead of being finished:
 *
 *   await userEvent.click(button);
 *   holdAnimationsAt(150, panel);
 *   await expectScreenshotsAtEverySize('panel-opening', panel, { heldAnimations: true });
 */
export function holdAnimationsAt(time: number, root: Element | Document = document): Animation[] {
  const animations =
    root instanceof Document ? root.getAnimations() : root.getAnimations({ subtree: true });
  for (const animation of animations) {
    animation.pause();
    animation.currentTime = time;
  }
  return animations;
}
