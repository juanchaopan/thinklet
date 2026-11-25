import { screen, within } from '@testing-library/angular';
import type { ChildMeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { NO_BOOKS, stubChildBooks } from '../../../testing/child-books';
import {
  REMEMBERED_XIAOMI,
  XIAOMI_ME,
  findSettingsLink,
  stubChildSignedIn,
  stubRemembered,
} from '../../../testing/child-login';
import { backToFront, recordCalls } from '../../../testing/family-page';
import { holdNext } from '../../../testing/held-answers';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import { ERROR_NUMBER, stubError, stubNoChild, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const PROFILE_PAGE = '/child/profile';

/** Opens the child's own settings with 小米 signed in and no parent, once they are shown. */
async function renderChildProfile() {
  stubVisitor();
  stubChildSignedIn();
  const rendered = await renderApp(PROFILE_PAGE);
  await screen.findByRole('heading', { level: 1, name: '个人设置' });
  return rendered;
}

/** Answers `PATCH /api/child/me` with 小米 renamed, and records the bodies it got. */
function stubRename(): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http.patch('/api/child/me', async ({ request }) => {
      const body = (await request.json()) as { nickname: string };
      bodies.push(body);
      return HttpResponse.json({ ...XIAOMI_ME, nickname: body.nickname } satisfies ChildMeResponse);
    }),
  );
  return bodies;
}

const nicknameBox = () => screen.getByRole<HTMLInputElement>('textbox', { name: '昵称' });
const pencil = () => screen.getByRole('button', { name: '改昵称' });
const saveButton = () => screen.getByRole('button', { name: '保存' });
const logoutButton = () => screen.getByRole<HTMLButtonElement>('button', { name: '退出登录' });

/** Edits the nickname in place, replacing it with `nickname`, and presses 保存. */
async function changeNicknameTo(nickname: string): Promise<void> {
  await userEvent.click(pencil());
  await userEvent.fill(nicknameBox(), nickname);
  await userEvent.click(saveButton());
}

/** The card of the settings, holding the nickname, the account and the family. */
function card(): HTMLElement {
  const section = screen.getByText('账号').closest('section');
  if (!section) {
    throw new Error('The settings card is not on the page');
  }
  return section;
}

/** The top bar of the child's pages. */
function topBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('app-child-top-bar');
  if (!bar) {
    throw new Error('The top bar is not on the page');
  }
  return bar;
}

/** Waits until no nickname box is left, including one in a sheet that is leaving. */
async function noNicknameBox(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('textbox', { name: '昵称' })).toHaveLength(0);
  });
}

/** Starts editing again from the page as it is, the way the current input device does it. */
async function startOver(): Promise<void> {
  if (screen.queryAllByRole('textbox', { name: '昵称' }).length > 0) {
    await userEvent.keyboard('{Escape}');
    await noNicknameBox();
  }
  await userEvent.click(pencil());
  await vi.waitFor(() => {
    expect(screen.getAllByRole('textbox', { name: '昵称' })).toHaveLength(1);
  });
}

/** Opens the 改昵称 sheet with the pencil; its box once it has the focus. */
async function openSheet(): Promise<{ sheet: HTMLElement; box: HTMLInputElement }> {
  await userEvent.click(pencil());
  const sheet = await screen.findByRole('dialog', { name: '改昵称' });
  const box = within(sheet).getByRole<HTMLInputElement>('textbox', { name: '昵称' });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(box);
  });
  return { sheet, box };
}

/** Waits until the sheet has gone. */
async function sheetGone(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

/** Waits until the app shows the child login with its form. */
async function expectChildLogin(): Promise<void> {
  expect(await screen.findByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
}

/** Lets `/api/child/me` answer again, presses 重试 and answers the settings card once it is back. */
async function retryWithTheChildBack(): Promise<HTMLElement> {
  stubChildSignedIn();
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('heading', { level: 1, name: '个人设置' });
  return card();
}

describe('ChildProfile', () => {
  it('shows the nickname, the account and the family, under the top bar marking the page', async () => {
    await renderChildProfile();

    expect(document.title).toBe('个人设置 - 好奇星球');
    expect(within(card()).getByText('昵称')).toBeTruthy();
    expect(within(card()).getByText('小米')).toBeTruthy();
    expect(within(card()).getByText('xiaomi')).toBeTruthy();
    expect(within(card()).getByText('家庭')).toBeTruthy();
    expect(within(card()).getByText('林悦的家')).toBeTruthy();
    expect(within(card()).getAllByRole('button')).toEqual([pencil()]);
    expect(logoutButton()).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回' }).getAttribute('href')).toBe('/child/home');
    const settings = await findSettingsLink();
    expect(topBar().contains(settings)).toBe(true);
    expect(settings.textContent).toContain('小米的个人设置');
    expect(settings.getAttribute('aria-current')).toBe('page');
    expect(settings.classList).toContain('bg-tint');
    expect(settings.querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
    expect(screen.queryByRole('navigation')).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-profile');
  });

  it("opens from the child's avatar on the home page, and goes back with 返回", async () => {
    stubChildBooks(NO_BOOKS);
    stubVisitor();
    stubChildSignedIn();
    const { router, fixture } = await renderApp('/child/home');

    await userEvent.click(await findSettingsLink());
    await fixture.whenStable();

    expect(router.url).toBe(PROFILE_PAGE);
    expect(await screen.findByRole('heading', { level: 1, name: '个人设置' })).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: '返回' }));
    await fixture.whenStable();

    expect(router.url).toBe('/child/home');
    expect(await screen.findByText('你好，小米！')).toBeTruthy();
  });

  it('edits the nickname in place with a mouse, starting from the current one', async () => {
    await renderChildProfile();

    await userEvent.click(pencil());

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(nicknameBox().value).toBe('小米');
    expect(document.activeElement).toBe(nicknameBox());
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-profile-edit-nickname', undefined, {
      prepare: startOver,
    });
  });

  it('saves a new nickname, trimmed, shows it in the card and the top bar, and says 已保存', async () => {
    const bodies = stubRename();
    const { fixture } = await renderChildProfile();

    await userEvent.click(pencil());
    await userEvent.clear(nicknameBox());
    await userEvent.type(nicknameBox(), '  米米 ');
    await userEvent.click(saveButton());
    await fixture.whenStable();

    expect(bodies).toEqual([{ nickname: '米米' }]);
    await noNicknameBox();
    expect(within(card()).getByText('米米')).toBeTruthy();
    expect(topBar().textContent).toContain('米米的个人设置');
    expect(topBar().querySelector('app-avatar')?.textContent).toBe('米');
    expect(await screen.findByText('已保存')).toBeTruthy();
  });

  it('greets the child by the new nickname back on the home page', async () => {
    stubRename();
    stubChildBooks(NO_BOOKS);
    const { fixture } = await renderChildProfile();

    await userEvent.click(pencil());
    await userEvent.fill(nicknameBox(), '米米');
    await userEvent.keyboard('{Enter}');
    await fixture.whenStable();
    await noNicknameBox();
    await userEvent.click(screen.getByRole('link', { name: '返回' }));

    expect(await screen.findByText('你好，米米！')).toBeTruthy();
  });

  it('cancels with Escape, keeping the nickname', async () => {
    const bodies = stubRename();
    await renderChildProfile();

    await userEvent.click(pencil());
    await userEvent.type(nicknameBox(), '米');
    await userEvent.keyboard('{Escape}');

    await noNicknameBox();
    expect(bodies).toEqual([]);
    expect(within(card()).getByText('小米')).toBeTruthy();
  });

  it('will not save an empty nickname: the box shakes and says so', async () => {
    const bodies = stubRename();
    await renderChildProfile();

    await userEvent.click(pencil());
    await userEvent.clear(nicknameBox());
    await userEvent.click(saveButton());

    expect(screen.getByText('请填昵称')).toBeTruthy();
    expect(nicknameBox().getAttribute('aria-invalid')).toBe('true');
    expect(nicknameBox().classList).toContain('animate-shake');
    expect(bodies).toEqual([]);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-profile-edit-nickname-error', undefined, {
      prepare: async () => {
        await startOver();
        await userEvent.clear(nicknameBox());
        const save = saveButton();
        await userEvent.click(save);
        await userEvent.unhover(save);
        await screen.findByText('请填昵称');
      },
    });
  });

  it.each([
    ['only spaces', '   ', '请填昵称'],
    ['11 characters', '一二三四五六七八九十一', '昵称最多 10 个字'],
  ])('will not save a nickname of %s', async (_case, nickname, hint) => {
    const bodies = stubRename();
    await renderChildProfile();

    await changeNicknameTo(nickname);

    expect(screen.getByText(hint)).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  it('saves a nickname of 10 characters, counting an emoji as one', async () => {
    const bodies = stubRename();
    const { fixture } = await renderChildProfile();
    const nickname = `${'米'.repeat(9)}🦊`;

    await changeNicknameTo(nickname);
    await fixture.whenStable();

    expect(bodies).toEqual([{ nickname }]);
  });

  it('shows the hint for a nickname the server rejects', async () => {
    stubError('patch /api/child/me', 400, 'invalid_request', {
      fields: [{ path: 'nickname', code: 'too_long' }],
    });
    const { fixture } = await renderChildProfile();

    await changeNicknameTo('小米');
    await fixture.whenStable();

    expect(screen.getByText('昵称最多 10 个字')).toBeTruthy();
  });

  it.each([
    ['the server fails', 500, 'internal'],
    ['the request is refused as coming from another site', 403, 'bad_origin'],
  ] as const)('keeps the typed nickname and shows a toast when %s', async (_case, status, code) => {
    stubError('patch /api/child/me', status, code);
    const { fixture } = await renderChildProfile();

    await changeNicknameTo('小米米');
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect(nicknameBox().value).toBe('小米米');
    expect(screen.queryByText('已保存')).toBeNull();
  });

  it('goes to the child login when saving says the login has ended', async () => {
    stubError('patch /api/child/me', 401, 'unauthenticated');
    const { router, fixture } = await renderChildProfile();
    stubRemembered();

    await changeNicknameTo('米米');
    await fixture.whenStable();

    await expectChildLogin();
    expect(router.url).toBe('/child');
    expect(screen.queryByText('出了点问题，请稍后再试')).toBeNull();
  });

  describe('on a touch screen', () => {
    beforeEach(async () => {
      await emulateTouch(true);
    });

    it('edits the nickname in a sheet titled 改昵称, starting from the current one', async () => {
      const bodies = stubRename();
      const { fixture } = await renderChildProfile();

      const { sheet, box } = await openSheet();
      expect(box.value).toBe('小米');
      await userEvent.type(box, '米');
      await userEvent.click(within(sheet).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ nickname: '小米米' }]);
      await sheetGone();
      expect(within(card()).getByText('小米米')).toBeTruthy();
      expect(await screen.findByText('已保存')).toBeTruthy();
    });

    it('closes the sheet with 取消, and the next one starts from the current nickname again', async () => {
      await renderChildProfile();
      const first = await openSheet();
      await userEvent.type(first.box, '米');

      await userEvent.click(within(first.sheet).getByRole('button', { name: '取消' }));
      await sheetGone();

      const { box } = await openSheet();
      expect(box.value).toBe('小米');
    });
  });

  describe('退出登录', () => {
    it('signs the child out only and opens the child login, where the avatar stays', async () => {
      const { router, fixture } = await renderChildProfile();
      const logouts = recordCalls(
        'post',
        '/api/child-auth/logout',
        () => new HttpResponse(null, { status: 204 }),
      );
      stubRemembered([REMEMBERED_XIAOMI]);

      await userEvent.click(logoutButton());
      await fixture.whenStable();

      expect(logouts).toEqual([null]);
      expect(router.url).toBe('/child');
      expect(await screen.findByRole('heading', { level: 1, name: '点你的头像登录' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /小米/ })).toBeTruthy();
    });

    it('cannot be pressed twice, and says a server failure in a toast, staying signed in', async () => {
      await renderChildProfile();
      const held = holdNext('post', '/api/child-auth/logout', () =>
        HttpResponse.json({}, { status: 500 }),
      );

      await userEvent.click(logoutButton());
      await held.reached;

      await vi.waitFor(() => {
        expect(logoutButton().disabled).toBe(true);
      });
      await held.release();
      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(logoutButton().disabled).toBe(false);
      expect(screen.getByRole('heading', { level: 1, name: '个人设置' })).toBeTruthy();
    });
  });

  it('sends a browser without a signed-in child to the child login', async () => {
    stubVisitor();
    stubRemembered();
    const { router } = await renderApp(PROFILE_PAGE);

    expect(router.url).toBe('/child');
    await expectChildLogin();
  });

  it('goes to the child login when the login has ended meanwhile', async () => {
    const { router, fixture } = await renderChildProfile();
    stubNoChild();
    stubRemembered();

    backToFront();
    await fixture.whenStable();

    await expectChildLogin();
    expect(router.url).toBe('/child');
  });

  it('says the page did not open when the settings cannot be read, keeping the top bar, and retries', async () => {
    stubVisitor();
    stubChildSignedIn();
    stubChildBooks(NO_BOOKS);
    const { fixture } = await renderApp('/child/home');
    const settings = await findSettingsLink();
    stubError('get /api/child/me', 500, 'internal');

    await userEvent.click(settings);
    await fixture.whenStable();

    expect(await screen.findByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();
    expect(topBar().contains(await findSettingsLink())).toBe(true);
    await expectNoAxeViolations();

    expect(within(await retryWithTheChildBack()).getByText('林悦的家')).toBeTruthy();
  });

  it('says the page did not open when the child cannot be loaded, and retries', async () => {
    stubVisitor();
    stubError('get /api/child/me', 500, 'internal');
    await renderApp(PROFILE_PAGE);

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();

    expect(within(await retryWithTheChildBack()).getByText('xiaomi')).toBeTruthy();
  });
});
