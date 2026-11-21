import { cdp } from 'vitest/browser';

/** Resolves after the browser has painted two more frames, once media query changes have been seen. */
export function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

/**
 * Makes the page a touch screen (`pointer: coarse`, no hover) or a mouse
 * screen again, the one switch between the finger and the mouse versions.
 * The design draws phones and tablets as touch screens and the desktop with
 * a mouse.
 */
export async function emulateTouch(enabled: boolean): Promise<void> {
  await cdp().send('Emulation.setTouchEmulationEnabled', {
    enabled,
    maxTouchPoints: enabled ? 5 : 1,
  });
  await nextFrames();
}

/** Turns the system's "reduce motion" setting on or off for the page. */
export async function emulateReducedMotion(enabled: boolean): Promise<void> {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: enabled ? 'reduce' : 'no-preference' }],
  });
  await nextFrames();
}
