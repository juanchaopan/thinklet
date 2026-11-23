import { render } from '@testing-library/angular';
import { DUODUO_ID, LELE_ID, XIAOMING_ID } from '../../../testing/children';
import { JIANGUO_ID, LINYUE_ID, ZIHANG_ID } from '../../../testing/sample-data';
import { Avatar, avatarColor } from './avatar';

/** Fixed ids, one after another, to see how the colours spread. */
const MANY_IDS = Array.from(
  { length: 50 },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
);

describe('avatarColor', () => {
  it('gives the parents of the design their colours', () => {
    expect(avatarColor(LINYUE_ID)).toBe('bg-violet');
    expect(avatarColor(ZIHANG_ID)).toBe('bg-sky');
    expect(avatarColor(JIANGUO_ID)).toBe('bg-mint-ink');
  });

  it('gives the children of the design their colours by the same rule', () => {
    expect(avatarColor(XIAOMING_ID)).toBe('bg-fuchsia');
    expect(avatarColor(DUODUO_ID)).toBe('bg-sun-ink');
    expect(avatarColor(LELE_ID)).toBe('bg-mint-ink');
  });

  it('gives the same person the same colour every time', () => {
    expect(MANY_IDS.map(avatarColor)).toEqual(MANY_IDS.map(avatarColor));
  });

  it('uses all five colours across people', () => {
    expect([...new Set(MANY_IDS.map(avatarColor))].sort()).toEqual(
      ['bg-fuchsia', 'bg-mint-ink', 'bg-sky', 'bg-sun-ink', 'bg-violet'].sort(),
    );
  });
});

describe('Avatar', () => {
  it('shows the first character of the name, hidden from screen readers', async () => {
    const { container } = await render(Avatar, {
      inputs: { name: '林悦', personId: LINYUE_ID },
    });

    expect(container.textContent).toBe('林');
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(container.getBoundingClientRect().width).toBe(36);
  });

  it('keeps a character made of several code points whole', async () => {
    const { container } = await render(Avatar, {
      inputs: { name: '👩‍👧小美', personId: LINYUE_ID },
    });

    expect(container.textContent).toBe('👩‍👧');
  });

  it("takes the person's own colour", async () => {
    const { container } = await render(Avatar, {
      inputs: { name: '周子航', personId: ZIHANG_ID },
    });

    expect(container.classList).toContain('bg-sky');
  });

  it.each([
    ['small', 32],
    ['large', 40],
  ] as const)('is %s at %i px', async (size, width) => {
    const { container } = await render(Avatar, {
      inputs: { name: '周子航', personId: ZIHANG_ID, size },
    });

    expect(container.getBoundingClientRect().width).toBe(width);
  });
});
