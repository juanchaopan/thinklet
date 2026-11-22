import { page, type Locator } from 'vitest/browser';
import { freezeAnimations, holdAnimationsAt, settleAnimations } from './animations';
import { emulateTouch, nextFrames } from './pointer';
import { VIEWPORTS, type ViewportName } from './viewports';

export interface ScreenshotOptions {
  /**
   * Areas whose content differs from run to run (a generated id, a remote
   * image). Playwright paints them over with a solid box before comparing.
   */
  mask?: Locator[];
  /**
   * Captures every animation on the page held `heldAt` milliseconds from its
   * start, for a key frame of a page's entrance. The animations are held at
   * each size after `prepare`, so an element shown only at some sizes (the
   * logo of the phone's top bar), whose animations start when it appears, is
   * held at the same moment as the rest. Without it, animations that a test
   * held (`holdAnimationsAt`, `holdOverlaysAt`) stay where they are, the
   * others that end are finished and endless ones are held at their start.
   */
  heldAt?: number;
  /**
   * Brings the page into the state at each size, after the size and the
   * input device are set: for a state reached differently with a finger and
   * with a mouse (a sheet or editing in place), or one held at a moment.
   */
  prepare?: (size: ViewportName) => Promise<void>;
}

/** Phones and tablets are drawn as touch screens, the desktop with a mouse (look.md). */
const TOUCH: Record<ViewportName, boolean> = { phone: true, tablet: true, desktop: false };

/**
 * Resolves once every picture on the page has loaded and is decoded, so a
 * capture never catches one still on its way (the first page of a test file
 * fetches the pictures for the first time). A picture that fails to load is
 * left as it is; the comparison then shows it.
 */
async function picturesReady(): Promise<void> {
  await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
}

/**
 * Whether something is shown above the page: a dialog, a sheet or a menu on
 * the CDK overlay, or a toast.
 */
function shownAbovePage(): boolean {
  const layers = Array.from(document.querySelectorAll('.cdk-overlay-pane'));
  const toasts = document.querySelector('app-toast-outlet');
  return (
    layers.some((layer) => layer.childElementCount > 0) || (toasts?.childElementCount ?? 0) > 0
  );
}

/**
 * Makes the screen as tall as the page, so a capture of the screen shows
 * all of it, and returns what puts the screen back to its size; nothing
 * when the page fits the screen.
 */
async function screenAsTallAsPage(
  width: number,
  height: number,
): Promise<(() => Promise<void>) | undefined> {
  const pageHeight = document.documentElement.scrollHeight;
  if (pageHeight <= height) {
    return undefined;
  }
  await page.viewport(width, pageHeight);
  return () => page.viewport(width, height);
}

/**
 * Compares one state with its baselines at every size in VIEWPORTS, named
 * `<name>-phone`, `<name>-tablet` and `<name>-desktop`. Phone and tablet are
 * captured as touch screens and the desktop with a mouse, so a state that
 * differs between the finger and the mouse versions shows each where the
 * design does; the page is left on the desktop with a mouse.
 *
 * Without a target the page is captured as the design draws it (README of
 * the design): one screen high while a dialog, a sheet, a menu or a toast is
 * shown above the page, which covers exactly the screen, and the whole page
 * however tall otherwise.
 *
 * Every capture is of a still page. Pictures are decoded and fonts loaded;
 * the page is given two frames to apply the new size, so what appears at
 * that size and what the pointer now rests on have started their
 * animations; every animation is then settled or held and turned into its
 * still look (freezeAnimations), and the compositor is given two frames to
 * draw it. Nothing moves between the captures the comparison takes, so the
 * same state gives the same pixels on every run, however busy the machine.
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
      // The page is still when captured; anything that starts moving after
      // that is finished by Playwright.
      animations: 'disabled' as const,
      caret: 'hide' as const,
      mask: options.mask ?? [],
    },
  };
  for (const size of Object.keys(VIEWPORTS) as ViewportName[]) {
    const { width, height } = VIEWPORTS[size];
    await page.viewport(width, height);
    await emulateTouch(TOUCH[size]);
    await options.prepare?.(size);
    await picturesReady();
    await document.fonts.ready;
    await nextFrames();
    if (options.heldAt === undefined) {
      settleAnimations({ keepHeld: true });
    } else {
      holdAnimationsAt(options.heldAt);
    }
    const thaw = freezeAnimations();
    const restoreScreen =
      target || shownAbovePage() ? undefined : await screenAsTallAsPage(width, height);
    await nextFrames();
    try {
      if (target) {
        await expect.element(target).toMatchScreenshot(`${name}-${size}`, matcherOptions);
      } else {
        await expect(page).toMatchScreenshot(`${name}-${size}`, matcherOptions);
      }
    } finally {
      await restoreScreen?.();
      thaw();
    }
  }
}
