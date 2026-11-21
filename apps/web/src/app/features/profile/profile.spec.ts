import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import { LINYUE, stubError, stubSignedIn } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const END_SESSION_URL = 'https://login.example.com/oidc/session/end?id_token_hint=token';

/** Answers `PATCH /api/me` with the parent renamed, and records the bodies it got. */
function stubRename(): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http.patch('/api/me', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      bodies.push(body);
      return HttpResponse.json({ ...LINYUE, name: body.name });
    }),
  );
  return bodies;
}

const nameBox = () => screen.getByRole('textbox', { name: '名字' });

/** Waits until no name box is left, including one in a sheet that is leaving. */
async function noNameBox(): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.queryAllByRole('textbox', { name: '名字' })).toHaveLength(0);
  });
}

/** Starts editing again from the page as it is, the way the current input device does it. */
async function startOver(): Promise<void> {
  if (screen.queryAllByRole('textbox', { name: '名字' }).length > 0) {
    await userEvent.keyboard('{Escape}');
    await noNameBox();
  }
  await userEvent.click(screen.getByRole('button', { name: '改名字' }));
  await vi.waitFor(() => {
    expect(screen.getAllByRole('textbox', { name: '名字' })).toHaveLength(1);
  });
}

describe('Profile', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('shows the name, the email and signing out', async () => {
    await renderApp('/profile');

    expect(document.title).toBe('个人设置 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '个人设置' })).toBeTruthy();
    expect(screen.getByText('linyue@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: '改名字' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /个人设置/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('profile');
  });

  it('shows — when the identity provider gave no email', async () => {
    worker.use(http.get('/api/me', () => HttpResponse.json({ ...LINYUE, email: null })));
    await renderApp('/profile');

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('edits the name in place with a mouse, starting from the current name', async () => {
    await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((nameBox() as HTMLInputElement).value).toBe('林悦');
    expect(document.activeElement).toBe(nameBox());
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('profile-edit-name', undefined, {
      prepare: startOver,
    });
  });

  it('saves a new name and shows it everywhere', async () => {
    const bodies = stubRename();
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), '  林小悦 ');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(bodies).toEqual([{ name: '林小悦' }]);
    await noNameBox();
    expect(screen.getAllByText('林小悦').length).toBeGreaterThan(1);
  });

  it('saves with Enter and cancels with Escape', async () => {
    stubRename();
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号');
    await userEvent.keyboard('{Escape}');
    await noNameBox();
    expect(screen.queryByText('林悦二号')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号{Enter}');
    await fixture.whenStable();

    await noNameBox();
    expect(screen.getAllByText('林悦二号').length).toBeGreaterThan(0);
  });

  it('will not save an empty name: the box shakes and says so', async () => {
    await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.clear(nameBox());
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('请填名字')).toBeTruthy();
    expect(nameBox().getAttribute('aria-invalid')).toBe('true');
    expect(nameBox().classList).toContain('animate-shake');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('profile-edit-name-error', undefined, {
      prepare: async () => {
        await startOver();
        await userEvent.clear(nameBox());
        const save = screen.getByRole('button', { name: '保存' });
        await userEvent.click(save);
        await userEvent.unhover(save);
        await screen.findByText('请填名字');
      },
    });
  });

  it.each([
    ['only spaces', '   ', '请填名字'],
    ['21 characters', '一二三四五六七八九十一二三四五六七八九十一', '名字最多 20 个字'],
  ])('will not save a name of %s', async (_case, name, hint) => {
    await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), name);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText(hint)).toBeTruthy();
  });

  it('saves a name of 20 characters, counting an emoji as one', async () => {
    const bodies = stubRename();
    const { fixture } = await renderApp('/profile');
    const name = `${'林'.repeat(19)}👩‍👧`;

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.fill(nameBox(), name);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(bodies).toEqual([{ name }]);
  });

  it('shows the hint for a name the server rejects', async () => {
    stubError('patch /api/me', 400, 'invalid_request', {
      fields: [{ path: 'name', code: 'too_long' }],
    });
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(screen.getByText('名字最多 20 个字')).toBeTruthy();
  });

  it('keeps the typed name and shows a toast when the server fails', async () => {
    stubError('patch /api/me', 500, 'internal');
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect((nameBox() as HTMLInputElement).value).toBe('林悦二号');
  });

  describe('on a touch screen', () => {
    beforeEach(async () => {
      await emulateTouch(true);
    });

    it('edits the name in a sheet titled 改名字', async () => {
      const bodies = stubRename();
      const { fixture } = await renderApp('/profile');

      await userEvent.click(screen.getByRole('button', { name: '改名字' }));
      const sheet = await screen.findByRole('dialog', { name: '改名字' });
      const box = within(sheet).getByRole<HTMLInputElement>('textbox', { name: '名字' });
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(box);
      });
      expect(box.value).toBe('林悦');

      await userEvent.type(box, '二号');
      await userEvent.click(within(sheet).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ name: '林悦二号' }]);
      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
    });

    it('closes the sheet with 取消 and starts from the current name next time', async () => {
      await renderApp('/profile');

      await userEvent.click(screen.getByRole('button', { name: '改名字' }));
      const sheet = await screen.findByRole('dialog', { name: '改名字' });
      await userEvent.type(within(sheet).getByRole('textbox'), '二号');
      await userEvent.click(within(sheet).getByRole('button', { name: '取消' }));
      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      await userEvent.click(screen.getByRole('button', { name: '改名字' }));
      const again = await screen.findByRole('dialog', { name: '改名字' });
      expect(within(again).getByRole<HTMLInputElement>('textbox').value).toBe('林悦');
    });
  });

  it('signs out here and at the identity provider', async () => {
    let signedOut = false;
    worker.use(
      http.post('/api/auth/logout', () => {
        signedOut = true;
        return HttpResponse.json({ endSessionUrl: END_SESSION_URL });
      }),
    );
    const { fixture, navigations } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await fixture.whenStable();

    expect(signedOut).toBe(true);
    expect(navigations).toEqual([END_SESSION_URL]);
  });

  it('stays and says so when signing out fails', async () => {
    worker.use(http.post('/api/auth/logout', () => HttpResponse.error()));
    const { fixture, navigations } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect(navigations).toEqual([]);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '退出登录' }).disabled).toBe(
      false,
    );
  });
});
