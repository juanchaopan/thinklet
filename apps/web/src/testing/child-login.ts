import { screen } from '@testing-library/angular';
import type { ChildLoginLinkInfo, ChildMeResponse, RememberedChild } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from './app';
import { DUODUO_ID, XIAOMING_ID } from './children';
import { codeBoxes, typeCode } from './families';
import { worker } from './network';
import { LINYUE_FAMILY, errorBody, stubVisitor } from './sample-data';

// The child's side as the design draws it: 小明 (account xiaoming) and 朵朵
// (account duoduo) of 林悦的家, whose family code is 7KQ4MZ, and helpers for
// the tests of the child login, the QR login and the child's home page.

/** The family code of 林悦的家, which the children type to log in. */
export const FAMILY_CODE = LINYUE_FAMILY.code;

/** The password the design shows typed in. */
export const PASSWORD = 'xm2019abc';

/** 小明 signed in, as `/api/child/me` and every login answer. */
export const XIAOMING_SIGNED_IN: ChildMeResponse = { id: XIAOMING_ID, nickname: '小明' };

/** 朵朵 signed in. */
export const DUODUO_SIGNED_IN: ChildMeResponse = { id: DUODUO_ID, nickname: '朵朵' };

/** 小明 and 朵朵 as a device that remembers them lists them. */
export const REMEMBERED_XIAOMING: RememberedChild = {
  childId: XIAOMING_ID,
  nickname: '小明',
  familyCode: FAMILY_CODE,
  account: 'xiaoming',
};

export const REMEMBERED_DUODUO: RememberedChild = {
  childId: DUODUO_ID,
  nickname: '朵朵',
  familyCode: FAMILY_CODE,
  account: 'duoduo',
};

/** The token of the login link in the tests, as the design's link writes it. */
export const LINK_TOKEN = 'EXAMPLE-TOKEN';

/** The QR login page of the link. */
export const QR_PAGE = `/child/qr/${LINK_TOKEN}`;

/** The link in the api. */
export const LINK_PATH = `/api/child-login-links/${LINK_TOKEN}`;

/** The link of 小明 before he has a password, and once he has one. */
export const LINK_NEEDS_PASSWORD: ChildLoginLinkInfo = {
  childId: XIAOMING_ID,
  nickname: '小明',
  needsPassword: true,
};

export const LINK_HAS_PASSWORD: ChildLoginLinkInfo = {
  ...LINK_NEEDS_PASSWORD,
  needsPassword: false,
};

/** Stubs `/api/child/me` with the child signed in on this browser. */
export function stubChildSignedIn(child: ChildMeResponse = XIAOMING_SIGNED_IN): void {
  worker.use(http.get('/api/child/me', () => HttpResponse.json(child)));
}

/** Stubs `GET /api/child-auth/remembered` with the children this browser remembers. */
export function stubRemembered(children: readonly RememberedChild[] = []): void {
  worker.use(http.get('/api/child-auth/remembered', () => HttpResponse.json(children)));
}

/** Stubs `GET /api/child-login-links/{token}` of the tests' link: its child, or no longer valid. */
export function stubLink(link: ChildLoginLinkInfo | 'invalid'): void {
  worker.use(
    http.get(LINK_PATH, () =>
      link === 'invalid'
        ? HttpResponse.json(errorBody('link_invalid'), { status: 404 })
        : HttpResponse.json(link),
    ),
  );
}

/** A login the api lets in, answered with the child now signed in. */
export function signedIn(child: ChildMeResponse = XIAOMING_SIGNED_IN): () => Response {
  return () => HttpResponse.json(child);
}

/**
 * Opens the child login with nobody signed in, on a device that remembers
 * the children given (none unless a test says otherwise).
 */
export async function renderChildLogin(remembered: readonly RememberedChild[] = []) {
  stubVisitor();
  stubRemembered(remembered);
  return renderApp('/child');
}

/** Opens the QR login of the tests' link with nobody signed in. */
export async function renderQrLogin(link: ChildLoginLinkInfo | 'invalid') {
  stubVisitor();
  stubLink(link);
  return renderApp(QR_PAGE);
}

/** The text box with the name, such as 账号 or 密码. */
export function field(name: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(name, { selector: 'input' });
}

/** Types the family code from its first box, then the account and the password, into the login form. */
export async function fillLoginForm(
  code: string = FAMILY_CODE,
  account = 'xiaoming',
  password: string = PASSWORD,
): Promise<void> {
  const [first] = codeBoxes();
  await userEvent.click(first);
  await typeCode(code);
  await userEvent.type(field('账号'), account);
  await userEvent.type(field('密码'), password);
}

/** Waits for the home page of the child with the nickname, with 退出 in its top bar. */
export async function expectChildHome(nickname: string): Promise<void> {
  await screen.findByRole('button', { name: '退出' });
  expect(screen.getByRole('banner').textContent).toContain(nickname);
  expect(screen.getByText(`你好，${nickname}！`)).toBeTruthy();
}
