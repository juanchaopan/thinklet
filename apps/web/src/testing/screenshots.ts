import { page, type Locator } from 'vitest/browser';
import { settleAnimations } from './animations';
import { emulateTouch, nextFrames } from './pointer';
import { VIEWPORTS, type ViewportName } from './viewports';

export interface ScreenshotOptions {
  /**
   * Areas whose content differs from run to run (a generated id, a remote
   * image). Playwright paints them over with a solid box before comparing.
   */
  mask?: Locator[];
  /**
   * Keep animations where `holdAnimationsAt` left them. Without it, finite
   * animations and transitions are finished and infinite ones are held at
   * their start before the capture, so every capture shows a settled state.
   */
  heldAnimations?: boolean;
  /**
   * Brings the page into the state at each size, after the size and the
   * input device are set: for a state reached differently with a finger and
   * with a mouse (a sheet or editing in place).
   */
  prepare?: (size: ViewportName) => Promise<void>;
}

/** Phones and tablets are drawn as touch screens, the desktop with a mouse (look.md). */
const TOUCH: Record<ViewportName, boolean> = { phone: true, tablet: true, desktop: false };

/**
 * Compares one state with its baselines at every size in VIEWPORTS, named
 * `<name>-phone`, `<name>-tablet` and `<name>-desktop`. Phone and tablet are
 * captured as touch screens and the desktop with a mouse, so a state that
 * differs between the finger and the mouse versions shows each where the
 * design does; the page is left on the desktop with a mouse. Without a
 * target the whole page is captured, which is what a page with no box of its
 * own needs.
 *
 * Baselines live in `__screenshots__/<test file>/` and are made only inside
 * the pinned Playwright image (`task test-component-update`), so fonts and
 * rendering are the same on every machine.
 */
export async function expectScreenshotsAtEverySize(
  name: string,
  target?: Locator,
  options: ScreenshotOptions = {},
): Promise<void> {
  const matcherOptions = {
    screenshotOptions: {
      animations: options.heldAnimations ? ('allow' as const) : ('disabled' as const),
      caret: 'hide' as const,
      mask: options.mask ?? [],
    },
  };
  for (const size of Object.keys(VIEWPORTS) as ViewportName[]) {
    const { width, height } = VIEWPORTS[size];
    await page.viewport(width, height);
    await emulateTouch(TOUCH[size]);
    await options.prepare?.(size);
    if (!options.heldAnimations) {
      settleAnimations();
      // Let the compositor drop the layers the animations used, which draw
      // edges slightly differently.
      await nextFrames();
    }
    await document.fonts.ready;
    if (target) {
      await expect.element(target).toMatchScreenshot(`${name}-${size}`, matcherOptions);
    } else {
      await expect(page).toMatchScreenshot(`${name}-${size}`, matcherOptions);
    }
  }
}
