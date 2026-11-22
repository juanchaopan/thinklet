/**
 * Holds every animation under `root` at `time` milliseconds from its start,
 * so a screenshot can show one chosen frame of it. This covers CSS
 * animations, CSS transitions and `element.animate()`, which all appear in
 * the Web Animations API: each one is paused and moved to that moment.
 *
 * A screenshot of the whole page at one moment passes `heldAt`, which holds
 * the page at every size. A part that a test opens at each size is held in
 * `prepare`; the screenshot keeps a held animation where it is and settles
 * the rest of the page:
 *
 *   await expectScreenshotsAtEverySize('panel-opening', undefined, {
 *     prepare: async () => {
 *       await userEvent.click(button);
 *       holdAnimationsAt(150, panel);
 *     },
 *   });
 */
export function holdAnimationsAt(time: number, root: Element | Document = document): Animation[] {
  const animations = animationsUnder(root);
  for (const animation of animations) {
    animation.pause();
    animation.currentTime = time;
  }
  return animations;
}

export interface SettleOptions {
  /** Leave paused animations where they are, as a test held them at a chosen moment. */
  keepHeld?: boolean;
}

/**
 * Brings every animation on the page to where it settles: animations that
 * end are finished, endless ones (the rabbit floating) are held at their
 * start. A screenshot or an accessibility check then sees the page at rest,
 * however recently something started moving.
 */
export function settleAnimations({ keepHeld = false }: SettleOptions = {}): void {
  for (const animation of document.getAnimations()) {
    if (keepHeld && animation.playState === 'paused') {
      continue;
    }
    if (animation.effect?.getComputedTiming().endTime === Infinity) {
      animation.pause();
      animation.currentTime = 0;
    } else {
      animation.finish();
    }
  }
}

/**
 * Turns every animation under `root` into a still picture of where it is
 * now: the values it gives its element (position, opacity, colours) are
 * written onto the element, transitions are switched off there, and the
 * animation is cancelled. Calling the returned function brings each
 * animation back as it was (running, paused or finished, at the same moment)
 * and removes what was written.
 *
 * A held animation can still be drawn from a frame the compositor made
 * before it was moved, and Playwright cancels and restarts endless
 * animations around each capture, so a capture of a page with animations,
 * even held ones, is not reliable; a still page always is. Animations of
 * pseudo-elements, which have no style of their own to write to, show the
 * element without them while frozen.
 */
export function freezeAnimations(root: Element | Document = document): () => void {
  const animations = animationsUnder(root);
  const looks = currentLooks(animations);
  const moments = animations.map(momentOf);
  for (const animation of animations) {
    animation.cancel();
  }
  const written = writeLooks(looks);

  return () => {
    // The animations come back while the still values are in place, and the
    // style is brought up to date before those values go: both give the same
    // look then, so removing the values starts no transition.
    for (const moment of moments) {
      restoreMoment(moment);
    }
    for (const target of looks.keys()) {
      getComputedStyle(target).getPropertyValue('transition');
    }
    for (const { target, property, value, priority } of written.reverse()) {
      target.style.setProperty(property, value, priority);
    }
  };
}

type StyledElement = HTMLElement | SVGElement;

/** The values each animated element shows now, per CSS property its animations change. */
type Looks = Map<StyledElement, Map<string, string>>;

/** Where an animation was before `freezeAnimations` cancelled it. */
interface Moment {
  animation: Animation;
  state: AnimationPlayState;
  time: CSSNumberish | null;
}

/** A property as an element's own style had it before `freezeAnimations` wrote over it. */
interface InlineValue {
  target: StyledElement;
  property: string;
  value: string;
  priority: string;
}

function animationsUnder(root: Element | Document): Animation[] {
  return root instanceof Document ? root.getAnimations() : root.getAnimations({ subtree: true });
}

function currentLooks(animations: Animation[]): Looks {
  const looks: Looks = new Map();
  for (const animation of animations) {
    const effect = animation.effect;
    const target = styledTarget(effect);
    if (!target || !(effect instanceof KeyframeEffect)) {
      continue;
    }
    const computed = getComputedStyle(target);
    const look = looks.get(target) ?? new Map<string, string>();
    for (const property of animatedProperties(effect)) {
      look.set(property, computed.getPropertyValue(property));
    }
    looks.set(target, look);
  }
  return looks;
}

/** Writes the looks onto their elements without transitions; returns what the elements had. */
function writeLooks(looks: Looks): InlineValue[] {
  const written: InlineValue[] = [];
  for (const [target, look] of looks) {
    for (const property of ['transition', ...look.keys()]) {
      written.push({
        target,
        property,
        value: target.style.getPropertyValue(property),
        priority: target.style.getPropertyPriority(property),
      });
    }
    target.style.setProperty('transition', 'none', 'important');
    for (const [property, value] of look) {
      target.style.setProperty(property, value, 'important');
    }
  }
  return written;
}

function momentOf(animation: Animation): Moment {
  return { animation, state: animation.playState, time: animation.currentTime };
}

function restoreMoment({ animation, state, time }: Moment): void {
  if (state === 'finished') {
    animation.finish();
    return;
  }
  if (time !== null) {
    animation.currentTime = time;
  }
  if (state === 'running') {
    animation.play();
  }
}

/** The element an effect changes, unless it changes a pseudo-element or no element at all. */
function styledTarget(effect: AnimationEffect | null): StyledElement | null {
  if (!(effect instanceof KeyframeEffect) || effect.pseudoElement) {
    return null;
  }
  const target = effect.target;
  return target instanceof HTMLElement || target instanceof SVGElement ? target : null;
}

/** Keyframe members that are not CSS properties. */
const KEYFRAME_TIMING = new Set(['offset', 'computedOffset', 'easing', 'composite']);

/** The CSS properties a keyframe effect changes, in their CSS spelling (`background-color`). */
function animatedProperties(effect: KeyframeEffect): Set<string> {
  const properties = new Set<string>();
  for (const keyframe of effect.getKeyframes()) {
    for (const name of Object.keys(keyframe)) {
      if (!KEYFRAME_TIMING.has(name)) {
        properties.add(
          name.startsWith('--')
            ? name
            : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        );
      }
    }
  }
  return properties;
}
