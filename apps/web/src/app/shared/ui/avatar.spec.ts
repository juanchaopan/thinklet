import { render } from '@testing-library/angular';
import { Avatar } from './avatar';

describe('Avatar', () => {
  it('shows the first character of the name, hidden from screen readers', async () => {
    const { container } = await render(Avatar, { inputs: { name: '林悦' } });

    expect(container.textContent).toBe('林');
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(container.getBoundingClientRect().width).toBe(36);
  });

  it('keeps a character made of several code points whole', async () => {
    const { container } = await render(Avatar, { inputs: { name: '👩‍👧小美' } });

    expect(container.textContent).toBe('👩‍👧');
  });

  it.each([
    [0, 'bg-violet'],
    [1, 'bg-sky'],
    [2, 'bg-mint-ink'],
    [3, 'bg-fuchsia'],
    [4, 'bg-sun-ink'],
    [5, 'bg-violet'],
  ])('gives the parent in place %i the colour %s', async (colorIndex, color) => {
    const { container } = await render(Avatar, { inputs: { name: '周子航', colorIndex } });

    expect(container.classList).toContain(color);
  });

  it('is 40 px in its large size', async () => {
    const { container } = await render(Avatar, { inputs: { name: '周子航', size: 'large' } });

    expect(container.getBoundingClientRect().width).toBe(40);
  });
});
