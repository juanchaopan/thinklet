import { page, type Locator } from 'vitest/browser';
import { VIEWPORTS, type ViewportName } from './viewports';

export interface ScreenshotOptions {
  /**
   * Areas whose content differs from run to run (a generated id, a remote
   * image). Playwright paints them over with a solid box before comparing.
   */
  mask?: Locator[];
  /**
   * Keep animations where `holdAnimationsAt` left them. Without it, finite
   * animations and transitions are finished and infinite ones are reset
   * before the capture, so every capture shows a settled state.
   */
  heldAnimations?: boolean;
}

/**
 * Compares one state with its baselines at every size in VIEWPORTS, named
 * `<name>-phone`, `<name>-tablet` and `<name>-desktop`. Without a target the
 * whole page is captured, which is what a page with no box of its own needs.
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
    await document.fonts.ready;
    if (target) {
      await expect.element(target).toMatchScreenshot(`${name}-${size}`, matcherOptions);
    } else {
      await expect(page).toMatchScreenshot(`${name}-${size}`, matcherOptions);
    }
  }
}
