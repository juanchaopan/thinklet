import { screen } from '@testing-library/angular';
import type { ErrorCode } from '@thinklet/contracts';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import {
  DOUDOU_SIGNED_IN,
  LINK_HAS_PASSWORD,
  LINK_NEEDS_PASSWORD,
  LINK_PATH,
  PASSWORD,
  QR_PAGE,
  expectChildHome,
  field,
  renderQrLogin,
  signedIn,
  stubChildSignedIn,
  stubLink,
  stubRemembered,
} from '../../../testing/child-login';
import { DOUDOU_ID } from '../../../testing/children';
import { recordCalls } from '../../../testing/family-page';
import { holdNext } from '../../../testing/held-answers';
import { moveMouseOffPage } from '../../../testing/pointer';
import { ERROR_NUMBER, errorBody, stubError, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const REMEMBER = '在这台设备上记住我';

/** Answers a call with the error code and status, as the api does. */
function refuse(code: ErrorCode, status: number): () => Response {
  return () => HttpResponse.json(errorBody(code), { status });
}

/** Presses the button, then takes the mouse off it, so the page shows it at rest. */
async function submit(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }));
  await moveMouseOffPage();
}

describe('ChildQrLogin', () => {
  describe('for a child without a password', () => {
    it('greets the child and asks for a password typed twice, remembering the device', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);

      expect(document.title).toBe('扫码登录 - 好奇星球');
      expect(screen.getByRole('heading', { level: 1, name: '你好，小米！' })).toBeTruthy();
      expect(screen.getByText('先设一个密码，以后登录要用。')).toBeTruthy();
      expect(field('密码').type).toBe('password');
      expect(field('密码').getAttribute('aria-describedby')).toBe(
        screen.getByText('6–32 个字符').id,
      );
      expect(field('再输一遍').type).toBe('password');
      expect(screen.getAllByRole('button', { name: '显示密码' })).toHaveLength(2);
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: REMEMBER }).checked).toBe(true);
      expect(screen.queryByRole('navigation')).toBeNull();
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(field('密码'));
      });
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-qr-set-password');
    });

    it.each([
      ['', '请设密码'],
      ['12345', '密码至少 6 个字符'],
      ['a'.repeat(33), '密码最多 32 个字符'],
    ])('says what is wrong with the password %j before sending it', async (password, hint) => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      const sets = recordCalls('post', `${LINK_PATH}/password`, signedIn());
      if (password) {
        await userEvent.type(field('密码'), password);
      }
      await userEvent.type(field('再输一遍'), password || 'x');

      await submit('设好了，进入');

      expect(await screen.findByText(hint)).toBeTruthy();
      expect(sets).toEqual([]);
    });

    it('counts the characters as they are seen', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      const sets = recordCalls('post', `${LINK_PATH}/password`, signedIn());
      const thumbs = '👍🏽'.repeat(6);
      await userEvent.fill(field('密码'), thumbs);
      await userEvent.fill(field('再输一遍'), thumbs);

      await submit('设好了，进入');

      await expectChildHome('小米');
      expect(sets).toEqual([{ password: thumbs, remember: true }]);
    });

    it('empties the second password when it differs from the first', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      const sets = recordCalls('post', `${LINK_PATH}/password`, signedIn());
      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.type(field('再输一遍'), 'xm2019abd');

      await submit('设好了，进入');

      expect(await screen.findByText('两次输的密码不一样')).toBeTruthy();
      expect(field('再输一遍').value).toBe('');
      expect(field('密码').value).toBe(PASSWORD);
      expect(sets).toEqual([]);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-qr-set-password-error');
    });

    it('sets the password and opens the home page, not remembering the device when unticked', async () => {
      const { router } = await renderQrLogin(LINK_NEEDS_PASSWORD);
      const sets = recordCalls('post', `${LINK_PATH}/password`, signedIn());
      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.type(field('再输一遍'), PASSWORD);
      await userEvent.click(screen.getByText(REMEMBER));

      await submit('设好了，进入');

      await expectChildHome('小米');
      expect(router.url).toBe('/child/home');
      expect(sets).toEqual([{ password: PASSWORD, remember: false }]);
    });

    it('says a password the api turns down under the field', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      stubError(`post ${LINK_PATH}/password`, 400, 'invalid_request', {
        fields: [{ path: 'password', code: 'too_short' }],
      });
      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.type(field('再输一遍'), PASSWORD);

      await submit('设好了，进入');

      expect(await screen.findByText('密码至少 6 个字符')).toBeTruthy();
    });

    it('shows the password form when the child got a password meanwhile', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      recordCalls('post', `${LINK_PATH}/password`, refuse('password_already_set', 409));
      stubLink(LINK_HAS_PASSWORD);
      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.type(field('再输一遍'), PASSWORD);

      await submit('设好了，进入');

      expect(await screen.findByText('输入你的密码。')).toBeTruthy();
      expect(screen.queryByLabelText('再输一遍')).toBeNull();
      expect(screen.queryByText('出了点问题，请稍后再试')).toBeNull();
    });

    it('sends once while the password is on its way, then says a server failure in a toast', async () => {
      await renderQrLogin(LINK_NEEDS_PASSWORD);
      const held = holdNext('post', `${LINK_PATH}/password`, refuse('internal', 500));
      await userEvent.type(field('密码'), PASSWORD);
      await userEvent.type(field('再输一遍'), PASSWORD);

      await submit('设好了，进入');
      await held.reached;

      const button = await screen.findByRole<HTMLButtonElement>('button', { name: '进入中…' });
      expect(button.disabled).toBe(true);
      await held.release();
      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(field('密码').value).toBe(PASSWORD);
    });
  });

  describe('for a child with a password', () => {
    it('greets the child and asks for the password, remembering the device', async () => {
      await renderQrLogin(LINK_HAS_PASSWORD);

      expect(screen.getByRole('heading', { level: 1, name: '你好，小米！' })).toBeTruthy();
      expect(screen.getByText('输入你的密码。')).toBeTruthy();
      expect(screen.queryByLabelText('再输一遍')).toBeNull();
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: REMEMBER }).checked).toBe(true);
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(field('密码'));
      });
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-qr-password');
    });

    it('asks for the password before sending anything', async () => {
      await renderQrLogin(LINK_HAS_PASSWORD);
      const logins = recordCalls('post', `${LINK_PATH}/login`, signedIn());

      await submit('登录');

      expect(await screen.findByText('请填密码')).toBeTruthy();
      expect(logins).toEqual([]);
    });

    it('says a wrong password and empties it, keeping the link for another try', async () => {
      await renderQrLogin(LINK_HAS_PASSWORD);
      recordCalls('post', `${LINK_PATH}/login`, refuse('wrong_password', 401));
      await userEvent.type(field('密码'), 'xm2019abd');

      await submit('登录');

      expect(await screen.findByText('密码不对')).toBeTruthy();
      expect(field('密码').value).toBe('');
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-qr-password-error');

      const logins = recordCalls('post', `${LINK_PATH}/login`, signedIn());
      await userEvent.type(field('密码'), PASSWORD);
      await submit('登录');

      await expectChildHome('小米');
      expect(logins).toEqual([{ password: PASSWORD, remember: true }]);
    });

    it('shows the form to set a password when the password was reset meanwhile', async () => {
      await renderQrLogin(LINK_HAS_PASSWORD);
      recordCalls('post', `${LINK_PATH}/login`, refuse('password_not_set', 409));
      stubLink(LINK_NEEDS_PASSWORD);
      await userEvent.type(field('密码'), PASSWORD);

      await submit('登录');

      expect(await screen.findByText('先设一个密码，以后登录要用。')).toBeTruthy();
      expect(field('再输一遍')).toBeTruthy();
    });

    it('says the link is no longer valid when it was used meanwhile', async () => {
      await renderQrLogin(LINK_HAS_PASSWORD);
      recordCalls('post', `${LINK_PATH}/login`, refuse('link_invalid', 404));
      await userEvent.type(field('密码'), PASSWORD);

      await submit('登录');

      expect(
        await screen.findByRole('heading', { level: 1, name: '这个二维码已经失效了' }),
      ).toBeTruthy();
    });
  });

  it('says a link that is no longer valid under the rabbit teacher, leading to the child login', async () => {
    const { router, fixture } = await renderQrLogin('invalid');

    expect(screen.getByRole('heading', { level: 1, name: '这个二维码已经失效了' })).toBeTruthy();
    expect(screen.getByText('请家长重新给你一个二维码。')).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-qr-invalid');

    stubRemembered();
    await userEvent.click(screen.getByRole('link', { name: '去登录页' }));
    await fixture.whenStable();

    expect(router.url).toBe('/child');
    expect(await screen.findByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
  });

  it('says the page did not open when the link cannot be read, and retries', async () => {
    stubVisitor();
    stubError(`get ${LINK_PATH}`, 500, 'internal');
    await renderApp(QR_PAGE);

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();

    stubLink(LINK_HAS_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('输入你的密码。')).toBeTruthy();
  });

  it('opens for a child already signed in, and signs the new child in in their place', async () => {
    stubVisitor();
    stubChildSignedIn();
    const { router, fixture } = await renderApp('/child/home');
    await expectChildHome('小米');
    stubLink({ childId: DOUDOU_ID, nickname: '豆豆', needsPassword: false });
    recordCalls('post', `${LINK_PATH}/login`, signedIn(DOUDOU_SIGNED_IN));

    await router.navigateByUrl(QR_PAGE);
    await fixture.whenStable();

    expect(router.url).toBe(QR_PAGE);
    await userEvent.type(field('密码'), PASSWORD);
    await submit('登录');

    await expectChildHome('豆豆');
    expect(router.url).toBe('/child/home');
  });
});
