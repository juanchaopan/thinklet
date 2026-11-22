import type { Provider } from '@angular/core';
import { screen, within } from '@testing-library/angular';
import type { ApplicantJoinRequest, FamilyCodeLookupResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { BrowserTimeZone } from '../app/shared/ui/time-zones';
import { holdAnimationsAt } from './animations';
import { worker } from './network';
import { nextFrames } from './pointer';
import { GRANDMA_LOOKUP, errorBody } from './sample-data';

// Helpers for the tests of creating a family and asking to join one.

/** Places the browser in a time zone, as it reports where it is; null reports none. */
export function browserIn(timeZone: string | null): Provider {
  return { provide: BrowserTimeZone, useValue: { current: () => timeZone } };
}

/** The family code the design's join dialog finds 外婆家 with. */
export const GRANDMA_CODE = '7KQ4MZ';

/** The six boxes of the join dialog. */
export function codeBoxes(): HTMLInputElement[] {
  return within(screen.getByRole('group', { name: '家庭码，6 位' })).getAllByRole('textbox');
}

/** What the six boxes hold, '' for an empty one. */
export function boxValues(): string[] {
  return codeBoxes().map((box) => box.value);
}

/** Waits for the boxes, with the focus in the first empty one, then types the text there. */
export async function typeCode(text: string, focusedBox = 0): Promise<void> {
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(codeBoxes()[focusedBox]);
  });
  await userEvent.keyboard(text);
}

/** Types a whole code into the join dialog and waits for the family it finds, to confirm. */
export async function findFamily(code = GRANDMA_CODE): Promise<HTMLElement> {
  await typeCode(code);
  return screen.findByRole('dialog', { name: '申请加入这个家庭？' });
}

/** Sends the request from the dialog that shows the family found. */
export async function sendRequest(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole('button', { name: '发送申请' }));
}

/**
 * Answers `GET /api/family-codes/{code}`: 外婆家 for GRANDMA_CODE (or the
 * given families by code), code_not_found for any other code. Returns the
 * codes looked up.
 */
export function stubFamilyCodes(
  families: Partial<Record<string, FamilyCodeLookupResponse>> = { [GRANDMA_CODE]: GRANDMA_LOOKUP },
): string[] {
  const asked: string[] = [];
  worker.use(
    http.get('/api/family-codes/:code', ({ params }) => {
      const code = String(params['code']);
      asked.push(code);
      const family = families[code];
      return family
        ? HttpResponse.json(family)
        : HttpResponse.json(errorBody('code_not_found'), { status: 404 });
    }),
  );
  return asked;
}

/** Answers `POST /api/join-requests` with the given new request, and records the bodies it got. */
export function stubSendRequest(created: ApplicantJoinRequest): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http.post('/api/join-requests', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(created, { status: 201 });
    }),
  );
  return bodies;
}

/**
 * Waits until what was just shown above the page (a dialog, a sheet or a
 * menu, with its backdrop) has begun its opening animations, and returns the
 * layer that holds it. A layer is drawn a moment after its first elements
 * appear, and only then do its animations start.
 */
async function overlaysOpening(): Promise<Element> {
  return vi.waitFor(() => {
    const container = document.querySelector('.cdk-overlay-container');
    if (!container) {
      throw new Error('Nothing has been shown above the page');
    }
    expect(container.getAnimations({ subtree: true }).length).toBeGreaterThan(0);
    return container;
  });
}

/**
 * Fixes what was just shown above the page at `time` milliseconds into its
 * opening; a time past the end fixes it fully open. Each animation is moved
 * to that moment, then its look there (position and opacity) is written onto
 * the element and the animation is dropped. A held animation can still be
 * drawn from a frame the compositor made before it was moved, so a capture
 * of it is not reliable; a still element always is.
 */
export async function holdOverlaysAt(time: number): Promise<void> {
  const container = await overlaysOpening();
  await nextFrames();
  const animations = holdAnimationsAt(time, container);
  const looks = animations.flatMap((animation) => {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    if (!(target instanceof HTMLElement)) {
      return [];
    }
    const { transform, opacity } = getComputedStyle(target);
    return [{ target, transform, opacity }];
  });
  for (const animation of animations) {
    animation.cancel();
  }
  for (const { target, transform, opacity } of looks) {
    target.style.animation = 'none';
    target.style.transform = transform;
    target.style.opacity = opacity;
  }
  await nextFrames();
}

/** Waits until no dialog is left, including one that is still leaving. */
export async function noDialog(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });
}
