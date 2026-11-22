import { freezeAnimations, holdAnimationsAt } from './animations';

/** An element on the page, removed again after the test. */
function element(): HTMLElement {
  const created = document.createElement('div');
  document.body.append(created);
  onTestFinished(() => {
    created.remove();
  });
  return created;
}

describe('holdAnimationsAt', () => {
  it('pauses every animation under the element at the given moment', () => {
    const target = element();
    const animation = target.animate([{ opacity: 0 }, { opacity: 1 }], 1000);

    const held = holdAnimationsAt(250, document.body);

    expect(held).toContain(animation);
    expect(animation.playState).toBe('paused');
    expect(animation.currentTime).toBe(250);
    expect(Number(getComputedStyle(target).opacity)).toBeCloseTo(0.25);
  });
});

describe('freezeAnimations', () => {
  it('leaves no animation, with each element still where its animation had it', () => {
    const target = element();
    target.animate(
      [
        { opacity: 0, transform: 'translateY(40px)' },
        { opacity: 1, transform: 'none' },
      ],
      1000,
    );
    holdAnimationsAt(500);

    freezeAnimations();

    expect(document.getAnimations()).toEqual([]);
    expect(Number(getComputedStyle(target).opacity)).toBeCloseTo(0.5);
    expect(getComputedStyle(target).transform).toBe('matrix(1, 0, 0, 1, 0, 20)');
    expect(getComputedStyle(target).transitionProperty).toBe('none');
  });

  it('brings each animation back as it was and removes what it wrote', () => {
    const target = element();
    target.style.opacity = '0.9';
    const held = target.animate([{ opacity: 0 }, { opacity: 1 }], 1000);
    held.pause();
    held.currentTime = 250;
    const running = element().animate([{ opacity: 0 }, { opacity: 1 }], 10_000);
    const finished = element().animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 100,
      fill: 'forwards',
    });
    finished.finish();

    freezeAnimations()();

    expect(held.playState).toBe('paused');
    expect(held.currentTime).toBe(250);
    expect(running.playState).toBe('running');
    expect(finished.playState).toBe('finished');
    expect(target.style.opacity).toBe('0.9');
    expect(target.style.transition).toBe('');
    expect(Number(getComputedStyle(target).opacity)).toBeCloseTo(0.25);
  });

  it('freezes only the animations under the given element', () => {
    const inside = element();
    const outside = element();
    const insideAnimation = inside.animate([{ opacity: 0 }, { opacity: 1 }], 1000);
    const outsideAnimation = outside.animate([{ opacity: 0 }, { opacity: 1 }], 1000);

    freezeAnimations(inside);

    expect(insideAnimation.playState).toBe('idle');
    expect(outsideAnimation.playState).toBe('running');
  });
});
