import { screen, within } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import {
  DOUDOU_SIGNED_IN,
  FAMILY_CODE,
  PASSWORD,
  REMEMBERED_DOUDOU,
  REMEMBERED_XIAOMI,
  expectChildHome,
  field,
  fillLoginForm,
  needsPassword,
  renderChildLogin,
  signedIn,
  stubChildSignedIn,
} from '../../../testing/child-login';
import { DOUDOU_ID, XIAOMI_ID } from '../../../testing/children';
import { boxValues, codeBoxes } from '../../../testing/families';
import { dialogGone, recordCalls } from '../../../testing/family-page';
import { holdNext } from '../../../testing/held-answers';
import { moveMouseOffPage } from '../../../testing/pointer';
import { errorBody, stubError, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const REMEMBER = '在这台设备上记住我';

/** The password 豆豆 sets at the first login. */
const NEW_PASSWORD = 'dd 2019';

/** The route that sets a first password with the family code and the account. */
const SET_PASSWORD_PATH = '/api/child-auth/password';

/** What the form says above 登录 when the login is turned down. */
const LOGIN_FAILED = '家庭码、账号或密码不对';

/** The box 在这台设备上记住我. */
function rememberBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('checkbox', { name: REMEMBER });
}

/** The avatar button of a remembered child, named by the nickname. */
function avatarButton(nickname: string): HTMLElement {
  return screen.getByRole('button', { name: nickname });
}

/** An api refusal with the code and status, and anything else the error carries. */
function refuse(code: Parameters<typeof errorBody>[0], status: number, extra = {}) {
  return () => HttpResponse.json(errorBody(code, extra), { status });
}

/** The api's refusal of a source that has tried too often, with 452 seconds left. */
const tooManyTries = () =>
  HttpResponse.json(errorBody('rate_limited', { retryAfterSeconds: 452 }), {
    status: 429,
    headers: { 'Retry-After': '452' },
  });

/** What the page says in its alert, once it says something. */
async function alertText(): Promise<string | undefined> {
  return (await screen.findByRole('alert')).textContent?.trim();
}

/**
 * Checks a state a click led to and captures it at every size, with nothing
 * hovered. The click leaves the mouse where it pressed, over whatever the
 * page shows there now (登录 after a failed login), and when the desktop
 * size gives the page its mouse back, the browser marks that element hovered
 * only once it next looks at the mouse, which on a busy machine may be
 * before the capture or after it. With the mouse off the page, the capture
 * never depends on that moment.
 */
async function expectAtRestAtEverySize(name: string): Promise<void> {
  await moveMouseOffPage();
  await expectNoAxeViolations();
  await expectScreenshotsAtEverySize(name);
}

/**
 * Opens the form, fills it in and presses 登录, the api answering with
 * `answer`; returns the logins sent and what the form then says above 登录.
 */
async function refusedLogin(
  answer: () => Response,
): Promise<{ logins: unknown[]; message: string | undefined }> {
  await renderChildLogin();
  const logins = recordCalls('post', '/api/child-auth/login', answer);
  await fillLoginForm();

  await userEvent.click(screen.getByRole('button', { name: '登录' }));

  return { logins, message: await alertText() };
}

/**
 * Logs 豆豆 in with the family code and the account, the box left empty and
 * the device to be remembered, and waits for the card that sets the first
 * password; returns the logins sent.
 */
async function reachSetPassword(): Promise<unknown[]> {
  await renderChildLogin();
  const logins = recordCalls('post', '/api/child-auth/login', needsPassword());
  await fillLoginForm(FAMILY_CODE, 'doudou', '');
  await userEvent.click(screen.getByText(REMEMBER));

  await userEvent.click(screen.getByRole('button', { name: '登录' }));

  await screen.findByRole('heading', { level: 1, name: '你好，豆豆！' });
  return logins;
}

/** Types the new password twice and presses 设好了，进入. */
async function setPassword(password = NEW_PASSWORD, repeat = password): Promise<void> {
  await userEvent.type(field('密码'), password);
  await userEvent.type(field('再输一遍'), repeat);
  await userEvent.click(screen.getByRole('button', { name: '设好了，进入' }));
}

describe('ChildLogin', () => {
  describe('on a device that remembers no child', () => {
    it('asks for the family code, the account and the password under the rabbit teacher', async () => {
      await renderChildLogin();

      expect(document.title).toBe('孩子登录 - 好奇星球');
      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(boxValues()).toEqual(['', '', '', '', '', '']);
      expect(field('账号').value).toBe('');
      expect(field('密码').type).toBe('password');
      expect(screen.getByRole('button', { name: '显示密码' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '忘记密码' })).toBeTruthy();
      expect(rememberBox().checked).toBe(false);
      expect(screen.getByText('还没有账号？请家长在「孩子」里添加。')).toBeTruthy();
      expect(screen.getByRole('link', { name: '回到首页' }).getAttribute('href')).toBe('/');
      expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
      expect(screen.queryByRole('navigation')).toBeNull();
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(codeBoxes()[0]);
      });
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-login');
    });

    it('takes the family code by the code rules and the account in small letters and digits', async () => {
      await renderChildLogin();

      await fillLoginForm('7kq4mz', 'XiaoMi_01', PASSWORD);

      expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
      expect(field('账号').value).toBe('xiaomi01');
      expect(screen.queryByText('没有这个家庭码')).toBeNull();
    });

    it('shows the password with the eye button and hides it again', async () => {
      await renderChildLogin();
      const eye = screen.getByRole('button', { name: '显示密码' });

      await userEvent.click(eye);

      expect(field('密码').type).toBe('text');
      expect(eye.getAttribute('aria-pressed')).toBe('true');
      await userEvent.click(eye);
      expect(field('密码').type).toBe('password');
      expect(eye.getAttribute('aria-pressed')).toBe('false');
    });

    it('says what is missing under the family code and the account before sending anything', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', signedIn());

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      expect(await screen.findByText('请填家庭码')).toBeTruthy();
      expect(screen.getByText('请填账号')).toBeTruthy();
      expect(screen.queryByText('请填密码')).toBeNull();
      expect(logins).toEqual([]);

      await fillLoginForm();

      expect(screen.queryByText('请填家庭码')).toBeNull();
      expect(screen.queryByText('请填账号')).toBeNull();
    });

    it('sends a login with the password box empty without a password', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', refuse('login_failed', 401));
      await fillLoginForm(FAMILY_CODE, 'xiaomi', '');

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      expect(await alertText()).toBe(LOGIN_FAILED);
      expect(logins).toEqual([{ code: FAMILY_CODE, account: 'xiaomi', remember: false }]);
    });

    it('says a login turned down without saying what was wrong, and empties the password', async () => {
      const { logins, message } = await refusedLogin(refuse('login_failed', 401));

      expect(message).toBe(LOGIN_FAILED);
      expect(logins).toEqual([
        { code: FAMILY_CODE, account: 'xiaomi', password: PASSWORD, remember: false },
      ]);
      expect(field('密码').value).toBe('');
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('xiaomi');
      await expectAtRestAtEverySize('child-login-error');
    });

    it('says a device that has tried too often how many minutes to wait, in the same place, and 登录 can still be pressed', async () => {
      const { logins, message } = await refusedLogin(tooManyTries);

      expect(message).toBe('试得太多了，请 8 分钟后再试');
      expect(field('密码').value).toBe('');
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('xiaomi');
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '登录' }).disabled).toBe(false);
      await expectAtRestAtEverySize('child-login-rate-limited');

      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      await vi.waitFor(() => {
        expect(logins).toHaveLength(2);
      });
    });

    it('signs the child in and opens the home page, remembering the device when ticked', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', signedIn());
      await fillLoginForm();
      await userEvent.click(screen.getByText(REMEMBER));

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      await expectChildHome('小米');
      expect(logins).toEqual([
        { code: FAMILY_CODE, account: 'xiaomi', password: PASSWORD, remember: true },
      ]);
    });

    it('sends once while the login is on its way, then says a server failure in a toast', async () => {
      await renderChildLogin();
      const held = holdNext('post', '/api/child-auth/login', refuse('internal', 500));
      await fillLoginForm();

      await userEvent.click(screen.getByRole('button', { name: '登录' }));
      await held.reached;

      const button = await screen.findByRole<HTMLButtonElement>('button', { name: '登录中…' });
      expect(button.disabled).toBe(true);
      await held.release();
      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '登录' }).disabled).toBe(false);
      expect(field('密码').value).toBe(PASSWORD);
    });

    it('goes back to the product home', async () => {
      const { router, fixture } = await renderChildLogin();

      await userEvent.click(screen.getByRole('link', { name: '回到首页' }));
      await fixture.whenStable();

      expect(router.url).toBe('/');
      expect(screen.getByRole('link', { name: '家长登录 / 注册' })).toBeTruthy();
    });

    it('shows the form when the remembered children cannot be read', async () => {
      stubVisitor();
      stubError('get /api/child-auth/remembered', 500, 'internal');
      await renderApp('/child');

      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
    });
  });

  describe('忘记密码', () => {
    it('explains in a dialog how a parent’s reset lets the child set a new password, and 知道了 closes it', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', signedIn());

      await userEvent.click(screen.getByRole('button', { name: '忘记密码' }));

      const dialog = await screen.findByRole('dialog', { name: '忘记密码了？' });
      expect(dialog.textContent).toContain(
        '请家长在「孩子」里点「重设密码」。之后 48 小时内用账号登录，或者扫家长给的二维码，就能设一个新密码。',
      );
      await expectAtRestAtEverySize('dialog-forgot-password');

      await userEvent.click(within(dialog).getByRole('button', { name: '知道了' }));

      await dialogGone('忘记密码了？');
      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(logins).toEqual([]);
    });

    it('is under the password box on the form opened from the remembered children too', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI]);

      await userEvent.click(screen.getByRole('button', { name: '用账号登录' }));

      expect(screen.getByRole('button', { name: '忘记密码' })).toBeTruthy();
    });
  });

  describe('for a child without a password yet', () => {
    it('turns the card into setting the first password, keeping 在这台设备上记住我', async () => {
      const logins = await reachSetPassword();

      expect(logins).toEqual([{ code: FAMILY_CODE, account: 'doudou', remember: true }]);
      expect(screen.getByText('先设一个密码，以后登录要用。')).toBeTruthy();
      const card = screen.getByRole('heading', { level: 1 }).closest('section');
      expect(card?.querySelector('app-avatar')?.classList).toContain('bg-sun-ink');
      expect(screen.getAllByRole('button', { name: '显示密码' })).toHaveLength(2);
      expect(screen.getByText('6–32 个字符')).toBeTruthy();
      expect(rememberBox().checked).toBe(true);
      expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
      expect(screen.getByText('还没有账号？请家长在「孩子」里添加。')).toBeTruthy();
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(field('密码'));
      });
      await expectAtRestAtEverySize('child-login-set-password');
    });

    it('turns into setting the password whatever the password box held', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', needsPassword());
      await fillLoginForm(FAMILY_CODE, 'doudou', 'guessed');

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      expect(await screen.findByRole('heading', { level: 1, name: '你好，豆豆！' })).toBeTruthy();
      expect(logins).toEqual([
        { code: FAMILY_CODE, account: 'doudou', password: 'guessed', remember: false },
      ]);
      expect(rememberBox().checked).toBe(false);
    });

    it('sets the password with the family code and the account and opens the home page', async () => {
      await reachSetPassword();
      const sets = recordCalls('post', SET_PASSWORD_PATH, signedIn(DOUDOU_SIGNED_IN));

      await setPassword();

      await expectChildHome('豆豆');
      expect(sets).toEqual([
        { code: FAMILY_CODE, account: 'doudou', password: NEW_PASSWORD, remember: true },
      ]);
    });

    it.each([
      ['12345', '12345', '密码至少 6 个字符'],
      [NEW_PASSWORD, 'dd 2018', '两次输的密码不一样'],
    ])(
      'says what is wrong with %j typed twice as %j before sending it',
      async (password, repeat, hint) => {
        await reachSetPassword();
        const sets = recordCalls('post', SET_PASSWORD_PATH, signedIn(DOUDOU_SIGNED_IN));

        await setPassword(password, repeat);

        expect(await screen.findByText(hint)).toBeTruthy();
        expect(sets).toEqual([]);
      },
    );

    it('goes back to the form as it was left with 返回', async () => {
      await reachSetPassword();

      await userEvent.click(screen.getByRole('button', { name: '返回' }));

      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('doudou');
      expect(rememberBox().checked).toBe(true);
    });

    it('goes back to the form with 家庭码、账号或密码不对 when the time to set it ran out meanwhile', async () => {
      await reachSetPassword();
      recordCalls('post', SET_PASSWORD_PATH, refuse('login_failed', 401));

      await setPassword();

      expect(await alertText()).toBe(LOGIN_FAILED);
      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(field('账号').value).toBe('doudou');
      expect(field('密码').value).toBe('');
    });

    it('says a password the api turns down under the field', async () => {
      await reachSetPassword();
      recordCalls(
        'post',
        SET_PASSWORD_PATH,
        refuse('invalid_request', 400, { fields: [{ path: 'password', code: 'too_long' }] }),
      );

      await setPassword();

      expect(await screen.findByText('密码最多 32 个字符')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: '你好，豆豆！' })).toBeTruthy();
    });

    it('says a device that has tried too often how many minutes to wait, above the button', async () => {
      await reachSetPassword();
      recordCalls('post', SET_PASSWORD_PATH, tooManyTries);

      await setPassword();

      expect(await alertText()).toBe('试得太多了，请 8 分钟后再试');
      expect(screen.getByRole('heading', { level: 1, name: '你好，豆豆！' })).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: '设好了，进入' }).disabled).toBe(
        false,
      );
    });
  });

  describe('on a device that remembers children', () => {
    it('shows each child as a big avatar to tap', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI, REMEMBERED_DOUDOU]);

      expect(screen.getByRole('heading', { level: 1, name: '点你的头像登录' })).toBeTruthy();
      const avatars = within(screen.getByRole('list')).getAllByRole('button');
      expect(avatars.map((avatar) => avatar.textContent?.replace(/\s/g, ''))).toEqual([
        '小小米',
        '豆豆豆',
      ]);
      expect(avatarButton('小米').querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
      expect(avatarButton('豆豆').querySelector('app-avatar')?.classList).toContain('bg-sun-ink');
      expect(screen.getByRole('button', { name: '用账号登录' })).toBeTruthy();
      expect(screen.getByRole('link', { name: '回到首页' })).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-login-remembered');
    });

    it('opens the form from 用账号登录, with 返回 back to the avatars', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI, REMEMBERED_DOUDOU]);

      await userEvent.click(screen.getByRole('button', { name: '用账号登录' }));

      expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
      expect(rememberBox().checked).toBe(false);
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(codeBoxes()[0]);
      });
      await expectAtRestAtEverySize('child-login-remembered-form');

      await userEvent.click(screen.getByRole('button', { name: '返回' }));

      expect(screen.getByRole('heading', { level: 1, name: '点你的头像登录' })).toBeTruthy();
    });

    it('signs a tapped child in without a password', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI, REMEMBERED_DOUDOU]);
      const logins = recordCalls(
        'post',
        `/api/child-auth/remembered/${DOUDOU_ID}/login`,
        signedIn(DOUDOU_SIGNED_IN),
      );

      await userEvent.click(avatarButton('豆豆'));

      await expectChildHome('豆豆');
      expect(logins).toEqual([null]);
    });

    it('asks for the password again when the device may no longer sign the child in', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI, REMEMBERED_DOUDOU]);
      recordCalls(
        'post',
        `/api/child-auth/remembered/${XIAOMI_ID}/login`,
        refuse('remember_invalid', 401),
      );

      await userEvent.click(avatarButton('小米'));

      const notice = await screen.findByRole('status');
      expect(notice.textContent?.trim()).toContain('这台设备需要重新输入密码');
      expect(notice.querySelector('app-avatar')?.textContent).toBe('小');
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('xiaomi');
      expect(field('密码').value).toBe('');
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(field('密码'));
      });
      await expectAtRestAtEverySize('child-login-relogin');

      await userEvent.click(screen.getByRole('button', { name: '返回' }));

      expect(screen.queryByRole('button', { name: '小米' })).toBeNull();
      expect(avatarButton('豆豆')).toBeTruthy();
    });

    it('has no 返回 once the last remembered child has gone', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI]);
      recordCalls(
        'post',
        `/api/child-auth/remembered/${XIAOMI_ID}/login`,
        refuse('remember_invalid', 401),
      );

      await userEvent.click(avatarButton('小米'));

      expect(await screen.findByRole('status')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
    });

    it('says a server failure in a toast and keeps the avatars', async () => {
      await renderChildLogin([REMEMBERED_XIAOMI]);
      stubError(`post /api/child-auth/remembered/${XIAOMI_ID}/login`, 500, 'internal');

      await userEvent.click(avatarButton('小米'));

      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(avatarButton('小米')).toBeTruthy();
    });
  });

  it('sends a child already signed in on to the home page', async () => {
    stubVisitor();
    stubChildSignedIn();
    const { router } = await renderApp('/child');

    expect(router.url).toBe('/child/home');
    await expectChildHome('小米');
  });
});
