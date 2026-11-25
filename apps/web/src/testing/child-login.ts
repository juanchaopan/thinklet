import { screen } from '@testing-library/angular';
import type {
  ChildLoginLinkInfo,
  ChildMeResponse,
  ChildNeedsPassword,
  RememberedChild,
  SignedInChild,
} from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from './app';
import { DOUDOU_ID, XIAOMI_ID } from './children';
import { codeBoxes, typeCode } from './families';
import { worker } from './network';
import { LINYUE_FAMILY, errorBody, stubVisitor } from './sample-data';

// The child's side as the design draws it: 小米 (account xiaomi) and 豆豆
// (account doudou) of 林悦的家, whose family code is 7KQ4MZ, and helpers for
// the tests of the child login, the QR login and the child's own pages.
// 豆豆 has no password yet and sets one at the first login.

/** The family code of 林悦的家, which the children type to log in. */
export const FAMILY_CODE = LINYUE_FAMILY.code;

/** The password the design shows typed in. */
export const PASSWORD = 'xm2019abc';

/** 小米 signed in, as every login answers. */
export const XIAOMI_SIGNED_IN: SignedInChild = { id: XIAOMI_ID, nickname: '小米' };

/** 豆豆 signed in. */
export const DOUDOU_SIGNED_IN: SignedInChild = { id: DOUDOU_ID, nickname: '豆豆' };

/** 小米 as `/api/child/me` answers: with the account and the family's name. */
export const XIAOMI_ME: ChildMeResponse = {
  ...XIAOMI_SIGNED_IN,
  account: 'xiaomi',
  familyName: LINYUE_FAMILY.name,
};

/** 豆豆 as `/api/child/me` answers. */
export const DOUDOU_ME: ChildMeResponse = {
  ...DOUDOU_SIGNED_IN,
  account: 'doudou',
  familyName: LINYUE_FAMILY.name,
};

/** 豆豆 as the login with the family code and the account answers a child who has to set a password. */
export const DOUDOU_NEEDS_PASSWORD: ChildNeedsPassword = {
  needsPassword: true,
  id: DOUDOU_ID,
  nickname: '豆豆',
};

/** 小米 and 豆豆 as a device that remembers them lists them. */
export const REMEMBERED_XIAOMI: RememberedChild = {
  childId: XIAOMI_ID,
  nickname: '小米',
  familyCode: FAMILY_CODE,
  account: 'xiaomi',
};

export const REMEMBERED_DOUDOU: RememberedChild = {
  childId: DOUDOU_ID,
  nickname: '豆豆',
  familyCode: FAMILY_CODE,
  account: 'doudou',
};

/** The token of the login link in the tests, as the design's link writes it. */
export const LINK_TOKEN = 'EXAMPLE-TOKEN';

/** The QR login page of the link. */
export const QR_PAGE = `/child/qr/${LINK_TOKEN}`;

/** The link in the api. */
export const LINK_PATH = `/api/child-login-links/${LINK_TOKEN}`;

/** The link of 小米 before the child has a password, and once the child has one. */
export const LINK_NEEDS_PASSWORD: ChildLoginLinkInfo = {
  childId: XIAOMI_ID,
  nickname: '小米',
  needsPassword: true,
};

export const LINK_HAS_PASSWORD: ChildLoginLinkInfo = {
  ...LINK_NEEDS_PASSWORD,
  needsPassword: false,
};

/** Stubs `/api/child/me` with the child signed in on this browser. */
export function stubChildSignedIn(child: ChildMeResponse = XIAOMI_ME): void {
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
export function signedIn(child: SignedInChild = XIAOMI_SIGNED_IN): () => Response {
  return () => HttpResponse.json(child);
}

/** A login with the family code and the account the api answers with the child who has to set a password. */
export function needsPassword(child: ChildNeedsPassword = DOUDOU_NEEDS_PASSWORD): () => Response {
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

/**
 * Types the family code from its first box, then the account and the
 * password, into the login form; an empty password leaves its box empty.
 */
export async function fillLoginForm(
  code: string = FAMILY_CODE,
  account = 'xiaomi',
  password: string = PASSWORD,
): Promise<void> {
  const [first] = codeBoxes();
  await userEvent.click(first);
  await typeCode(code);
  await userEvent.type(field('账号'), account);
  if (password !== '') {
    await userEvent.type(field('密码'), password);
  }
}

/**
 * The link to the child's own settings in the top bar of the child's
 * pages: the child's avatar, heard as "<nickname>的个人设置".
 */
export function findSettingsLink(): Promise<HTMLElement> {
  return screen.findByRole('link', { name: /的个人设置$/ });
}

/**
 * Waits for the home page of the child with the nickname: the child's
 * avatar in its top bar, leading to the child's own settings, and the
 * greeting. The top bar has no way to sign out.
 */
export async function expectChildHome(nickname: string): Promise<void> {
  const settings = await findSettingsLink();
  expect(settings.closest('app-child-top-bar')).not.toBeNull();
  expect(settings.textContent).toContain(`${nickname}的个人设置`);
  expect(screen.queryByRole('button', { name: /退出/ })).toBeNull();
  expect(screen.getByText(`你好，${nickname}！`)).toBeTruthy();
}
