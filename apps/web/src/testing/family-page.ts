import { Clipboard } from '@angular/cdk/clipboard';
import type { Provider } from '@angular/core';
import { screen } from '@testing-library/angular';
import type { FamilyDetail, MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { ShareSheet } from '../app/features/family/invitation';
import { renderApp } from './app';
import { browserIn } from './families';
import { worker } from './network';
import {
  GRANDMA_FAMILY,
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_ID,
  stubSignedIn,
} from './sample-data';

// Helpers for the tests of a family's own pages: the family page with its
// requests waiting, and the frame around it.

export interface FamilyPageOptions {
  me?: MeResponse;
  families?: readonly FamilyDetail[];
  /** Where the browser reports it is; the family's own zone unless a test places it elsewhere. */
  browserZone?: string | null;
  providers?: Provider[];
}

/**
 * Opens a page of 林悦的家 (its family page unless another address is
 * given) as 林悦, its admin, with the browser in the family's time zone.
 */
export async function renderFamilyPage(
  url = `/families/${LINYUE_FAMILY_ID}`,
  {
    me = LINYUE,
    families = [LINYUE_FAMILY, GRANDMA_FAMILY],
    browserZone = 'Asia/Shanghai',
    providers = [],
  }: FamilyPageOptions = {},
) {
  stubSignedIn(me, families);
  return renderApp(url, { providers: [browserIn(browserZone), ...providers] });
}

/** A clipboard that records what is copied, instead of the system's. */
export function fakeClipboard(): { provider: Provider; copied: string[] } {
  const copied: string[] = [];
  const clipboard = {
    copy: (text: string) => {
      copied.push(text);
      return true;
    },
  };
  return { provider: { provide: Clipboard, useValue: clipboard }, copied };
}

/**
 * A share sheet that records what is shared, or that the browser has none.
 * `answer` is how sharing ends: shared, or the parent closing the sheet.
 */
export function fakeShareSheet(
  available: boolean,
  answer: 'shared' | 'closed' = 'shared',
): { provider: Provider; shared: string[] } {
  const shared: string[] = [];
  const sheet = {
    canShare: () => available,
    share: (text: string) => {
      shared.push(text);
      return answer === 'shared'
        ? Promise.resolve()
        : Promise.reject(new DOMException('The sheet was closed', 'AbortError'));
    },
  };
  return { provider: { provide: ShareSheet, useValue: sheet }, shared };
}

/**
 * Answers `GET /api/me` and `GET /api/families/{familyId}` from now on with
 * the parent and the family as they are after a change, as the api does.
 */
export function stubChangedWorld(me: MeResponse, family: FamilyDetail): void {
  worker.use(
    http.get('/api/me', () => HttpResponse.json(me)),
    http.get(`/api/families/${family.id}`, () => HttpResponse.json(family)),
  );
}

/** Records the bodies of the calls to one address and method, answering each with `answer`. */
export function recordCalls(
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  answer: () => Response,
): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http[method](path, async ({ request }) => {
      const text = await request.text();
      bodies.push(text ? JSON.parse(text) : null);
      return answer();
    }),
  );
  return bodies;
}

/** Whether a toast with the text is on screen. */
export async function expectToast(text: string): Promise<void> {
  expect(await screen.findByText(text)).toBeTruthy();
}

/**
 * Waits until the library of the sample books (`stubLibrary`) is shown with
 * every cover loaded, so no cover is still on its way to the stubs once the
 * test is over.
 */
export async function libraryShown(): Promise<void> {
  await screen.findByRole('link', { name: '胡萝卜数数大冒险' });
  await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
}

/** Brings the window back to the front, as switching back to its tab does. */
export function backToFront(): void {
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Waits until the dialog with the name has left, including its leaving animation. */
export async function dialogGone(name: string | RegExp): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('dialog', { name })).toHaveLength(0);
  });
}

/** Opens the dialog with the button of that name and returns it. */
export async function openDialog(button: string | RegExp, dialog: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: button }));
  return screen.findByRole('dialog', { name: dialog });
}
