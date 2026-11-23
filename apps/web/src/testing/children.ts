import { screen } from '@testing-library/angular';
import type { Child, ChildDevice, ChildLoginLink, ChildLoginLinkStatus } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { FIXED_NOW } from './clock';
import { dialogGone, expectToast, renderFamilyPage, type FamilyPageOptions } from './family-page';
import { closeMenu } from './menus';
import { worker } from './network';
import { LINYUE_FAMILY_ID, errorBody } from './sample-data';

// The children of 林悦的家 the design draws, and helpers for the tests of the
// children page. The children's ids give them the design's avatar colours:
// 小明 fuchsia, 朵朵 sun, 乐乐 mint.

export const XIAOMING_ID = '3f9b2c1d-4e5a-4b6c-8d7e-9f0a1b2c3d00';
export const DUODUO_ID = '7a2e4c6b-8d1f-4a3e-9b5c-6d7e8f9a0b00';
export const LELE_ID = 'b8c4d2e6-1f3a-4c5b-8e7d-0a9b1c2d3e03';

export const XIAOMING: Child = { id: XIAOMING_ID, nickname: '小明', account: 'xiaoming' };
export const DUODUO: Child = { id: DUODUO_ID, nickname: '朵朵', account: 'duoduo' };
export const LELE: Child = { id: LELE_ID, nickname: '乐乐', account: 'lele2019' };

/** 林悦的家's children in the order they were added. */
export const CHILDREN: readonly Child[] = [XIAOMING, DUODUO, LELE];

/**
 * The devices 小明 is remembered on, latest login first, at the times the
 * design writes in Shanghai: remembered on 18 and 20 November, last used on
 * 22 November at 09:12 and 21 November at 19:40.
 */
export const XIAOMING_DEVICES: readonly ChildDevice[] = [
  {
    id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f01',
    name: 'iPad · Safari',
    rememberedAt: '2026-11-18T08:30:00Z',
    lastUsedAt: '2026-11-22T01:12:00Z',
  },
  {
    id: 'd2e3f4a5-b6c7-4e8f-9a0b-1c2d3e4f5a01',
    name: 'Android 手机 · Chrome',
    rememberedAt: '2026-11-20T03:05:00Z',
    lastUsedAt: '2026-11-21T11:40:00Z',
  },
];

/** The address of 林悦的家's children in the api. */
export const CHILDREN_PATH = `/api/families/${LINYUE_FAMILY_ID}/children`;

/** The address of one child of 林悦的家 in the api, with what follows it. */
export function childPath(childId: string, suffix = ''): string {
  return `${CHILDREN_PATH}/${childId}${suffix}`;
}

/**
 * The login link made for 小明, with 9 minutes 41 seconds left at the tests'
 * fixed time, as the design shows it. The address is the design's, so the QR
 * code is the one it draws.
 */
export const XIAOMING_LINK: ChildLoginLink = {
  id: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a01',
  url: 'https://thinklet-web.vercel.app/child/qr/EXAMPLE-TOKEN',
  expiresAt: new Date(FIXED_NOW.getTime() + (9 * 60 + 41) * 1000).toISOString(),
};

/** Stubs `GET /api/families/{familyId}/children` of 林悦的家 with the children. */
export function stubChildren(children: readonly Child[] = CHILDREN): void {
  worker.use(http.get(CHILDREN_PATH, () => HttpResponse.json(children)));
}

/**
 * Opens the children page of 林悦的家 as 林悦 with the children given (the
 * design's three unless a test says otherwise).
 */
export async function renderChildrenPage(
  children: readonly Child[] = CHILDREN,
  options: FamilyPageOptions = {},
) {
  stubChildren(children);
  return renderFamilyPage(`/families/${LINYUE_FAMILY_ID}/children`, options);
}

/** The row of the child with the nickname. */
export function childRow(nickname: string): HTMLElement {
  const row = screen.getByText(nickname, { selector: 'p' }).closest('li');
  if (!row) {
    throw new Error(`No row for ${nickname}`);
  }
  return row;
}

/**
 * Answers the making of 小明's login links with `link` and the checks of a
 * link with `status`; returns the number of links made and checks answered
 * by these stubs so far.
 */
export function stubLoginLinks(
  status: () => ChildLoginLinkStatus | 'invalid',
  link: ChildLoginLink = XIAOMING_LINK,
): { made: number; checked: number } {
  const counts = { made: 0, checked: 0 };
  worker.use(
    http.post(childPath(XIAOMING_ID, '/login-links'), () => {
      counts.made++;
      return HttpResponse.json(link, { status: 201 });
    }),
    http.get(childPath(XIAOMING_ID, '/login-links/:linkId'), () => {
      counts.checked++;
      const found = status();
      return found === 'invalid'
        ? HttpResponse.json(errorBody('not_found'), { status: 404 })
        : HttpResponse.json({ status: found, expiresAt: link.expiresAt });
    }),
  );
  return counts;
}

/** Stubs `GET …/children/{小明}/devices` with the devices. */
export function stubDevices(devices: readonly ChildDevice[] = XIAOMING_DEVICES): void {
  worker.use(http.get(childPath(XIAOMING_ID, '/devices'), () => HttpResponse.json(devices)));
}

/** Opens a child's actions afresh, as the current input device does it. */
export async function openActions(nickname = '小明'): Promise<HTMLElement> {
  await closeMenu();
  const button = childRow(nickname).querySelector<HTMLElement>('button[aria-label="更多操作"]');
  if (!button) {
    throw new Error(`No actions for ${nickname}`);
  }
  await userEvent.click(button);
  return screen.findByRole('menu', { name: `${nickname}的操作` });
}

/** Chooses one of the child's actions and returns the dialog it opens. */
export async function chooseAction(
  action: string,
  dialog: string,
  nickname = '小明',
): Promise<HTMLElement> {
  await openActions(nickname);
  await userEvent.click(screen.getByRole('menuitem', { name: action }));
  return screen.findByRole('dialog', { name: dialog });
}

/**
 * Expects what a parent sees after acting for 小明 once another parent has
 * deleted him: 这个孩子已经被删除了, the dialog titled `dialog` gone, and the
 * children read again without him.
 */
export async function expectXiaomingGone(dialog: string): Promise<void> {
  await expectToast('这个孩子已经被删除了');
  await dialogGone(dialog);
  await vi.waitFor(() => {
    expect(screen.queryByText('小明')).toBeNull();
  });
}
