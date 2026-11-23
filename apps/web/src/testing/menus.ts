import { screen } from '@testing-library/angular';

/**
 * Closes the menu on screen, if there is one, as Escape does, and waits
 * until it has gone. The key is sent to the menu itself: a menu held at the
 * start of its opening is out of sight and cannot be clicked, and a key sent
 * this way leaves the page in mouse mode, so the menu opened next shows no
 * keyboard focus ring.
 */
export async function closeMenu(): Promise<void> {
  const menu = screen.queryByRole('menu');
  if (!menu) {
    return;
  }
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
  });
}
