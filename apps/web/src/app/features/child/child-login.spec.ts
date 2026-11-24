import { screen, within } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import {
  DUODUO_SIGNED_IN,
  FAMILY_CODE,
  PASSWORD,
  REMEMBERED_DUODUO,
  REMEMBERED_XIAOMING,
  expectChildHome,
  field,
  fillLoginForm,
  renderChildLogin,
  signedIn,
  stubChildSignedIn,
} from '../../../testing/child-login';
import { DUODUO_ID, XIAOMING_ID } from '../../../testing/children';
import { boxValues, codeBoxes } from '../../../testing/families';
import { recordCalls } from '../../../testing/family-page';
import { holdNext } from '../../../testing/held-answers';
import { moveMouseOffPage } from '../../../testing/pointer';
import { errorBody, stubError, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const REMEMBER = '在这台设备上记住我';

/** The box 在这台设备上记住我. */
function rememberBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('checkbox', { name: REMEMBER });
}

/** The avatar button of a remembered child, named by the nickname. */
function avatarButton(nickname: string): HTMLElement {
  return screen.getByRole('button', { name: nickname });
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

      await fillLoginForm('7kq4mz', 'XiaoMing_01', PASSWORD);

      expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
      expect(field('账号').value).toBe('xiaoming01');
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

    it('says what is missing under each field before sending anything', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', signedIn());

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      expect(await screen.findByText('请填家庭码')).toBeTruthy();
      expect(screen.getByText('请填账号')).toBeTruthy();
      expect(screen.getByText('请填密码')).toBeTruthy();
      expect(logins).toEqual([]);

      await fillLoginForm();

      expect(screen.queryByText('请填家庭码')).toBeNull();
      expect(screen.queryByText('请填账号')).toBeNull();
      expect(screen.queryByText('请填密码')).toBeNull();
    });

    it('says a login turned down without saying what was wrong, and empties the password', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', () =>
        HttpResponse.json(errorBody('login_failed'), { status: 401 }),
      );
      await fillLoginForm();

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      expect((await screen.findByRole('alert')).textContent?.trim()).toBe('家庭码、账号或密码不对');
      expect(logins).toEqual([
        { code: FAMILY_CODE, account: 'xiaoming', password: PASSWORD, remember: false },
      ]);
      expect(field('密码').value).toBe('');
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('xiaoming');
      await expectAtRestAtEverySize('child-login-error');
    });

    it('signs the child in and opens the home page, remembering the device when ticked', async () => {
      await renderChildLogin();
      const logins = recordCalls('post', '/api/child-auth/login', signedIn());
      await fillLoginForm();
      await userEvent.click(screen.getByText(REMEMBER));

      await userEvent.click(screen.getByRole('button', { name: '登录' }));

      await expectChildHome('小明');
      expect(logins).toEqual([
        { code: FAMILY_CODE, account: 'xiaoming', password: PASSWORD, remember: true },
      ]);
    });

    it('sends once while the login is on its way, then says a server failure in a toast', async () => {
      await renderChildLogin();
      const held = holdNext('post', '/api/child-auth/login', () =>
        HttpResponse.json(errorBody('internal'), { status: 500 }),
      );
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

  describe('on a device that remembers children', () => {
    it('shows each child as a big avatar to tap', async () => {
      await renderChildLogin([REMEMBERED_XIAOMING, REMEMBERED_DUODUO]);

      expect(screen.getByRole('heading', { level: 1, name: '点你的头像登录' })).toBeTruthy();
      const avatars = within(screen.getByRole('list')).getAllByRole('button');
      expect(avatars.map((avatar) => avatar.textContent?.replace(/\s/g, ''))).toEqual([
        '小小明',
        '朵朵朵',
      ]);
      expect(avatarButton('小明').querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
      expect(avatarButton('朵朵').querySelector('app-avatar')?.classList).toContain('bg-sun-ink');
      expect(screen.getByRole('button', { name: '用账号登录' })).toBeTruthy();
      expect(screen.getByRole('link', { name: '回到首页' })).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-login-remembered');
    });

    it('opens the form from 用账号登录, with 返回 back to the avatars', async () => {
      await renderChildLogin([REMEMBERED_XIAOMING, REMEMBERED_DUODUO]);

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
      await renderChildLogin([REMEMBERED_XIAOMING, REMEMBERED_DUODUO]);
      const logins = recordCalls(
        'post',
        `/api/child-auth/remembered/${DUODUO_ID}/login`,
        signedIn(DUODUO_SIGNED_IN),
      );

      await userEvent.click(avatarButton('朵朵'));

      await expectChildHome('朵朵');
      expect(logins).toEqual([null]);
    });

    it('asks for the password again when the device may no longer sign the child in', async () => {
      await renderChildLogin([REMEMBERED_XIAOMING, REMEMBERED_DUODUO]);
      recordCalls('post', `/api/child-auth/remembered/${XIAOMING_ID}/login`, () =>
        HttpResponse.json(errorBody('remember_invalid'), { status: 401 }),
      );

      await userEvent.click(avatarButton('小明'));

      const notice = await screen.findByRole('status');
      expect(notice.textContent?.trim()).toContain('这台设备需要重新输入密码');
      expect(notice.querySelector('app-avatar')?.textContent).toBe('小');
      expect(boxValues().join('')).toBe(FAMILY_CODE);
      expect(field('账号').value).toBe('xiaoming');
      expect(field('密码').value).toBe('');
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(field('密码'));
      });
      await expectAtRestAtEverySize('child-login-relogin');

      await userEvent.click(screen.getByRole('button', { name: '返回' }));

      expect(screen.queryByRole('button', { name: '小明' })).toBeNull();
      expect(avatarButton('朵朵')).toBeTruthy();
    });

    it('has no 返回 once the last remembered child has gone', async () => {
      await renderChildLogin([REMEMBERED_XIAOMING]);
      recordCalls('post', `/api/child-auth/remembered/${XIAOMING_ID}/login`, () =>
        HttpResponse.json(errorBody('remember_invalid'), { status: 401 }),
      );

      await userEvent.click(avatarButton('小明'));

      expect(await screen.findByRole('status')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '返回' })).toBeNull();
    });

    it('says a server failure in a toast and keeps the avatars', async () => {
      await renderChildLogin([REMEMBERED_XIAOMING]);
      stubError(`post /api/child-auth/remembered/${XIAOMING_ID}/login`, 500, 'internal');

      await userEvent.click(avatarButton('小明'));

      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(avatarButton('小明')).toBeTruthy();
    });
  });

  it('sends a child already signed in on to the home page', async () => {
    stubVisitor();
    stubChildSignedIn();
    const { router } = await renderApp('/child');

    expect(router.url).toBe('/child/home');
    await expectChildHome('小明');
  });
});
