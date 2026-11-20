import { holdAnimationsAt } from './animations';

describe('holdAnimationsAt', () => {
  it('pauses every animation under the element at the given moment', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], 1000);

    const held = holdAnimationsAt(250, document.body);

    expect(held).toContain(animation);
    expect(animation.playState).toBe('paused');
    expect(animation.currentTime).toBe(250);
    expect(Number(getComputedStyle(element).opacity)).toBeCloseTo(0.25);
    element.remove();
  });
});
