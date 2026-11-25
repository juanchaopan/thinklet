import type { FamilyDetail, MeResponse } from '@thinklet/contracts';
import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { dialogGone, expectToast, openDialog, recordCalls } from '../../../testing/family-page';
import { worker } from '../../../testing/network';
import { emulateTouch } from '../../../testing/pointer';
import {
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  LINYUE_WITHOUT_FAMILY,
  stubError,
  stubSignedIn,
  ZIHANG,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

const END_SESSION_URL = 'https://login.example.com/oidc/session/end?id_token_hint=token';

/** 爷爷奶奶家, the second family the design's 林悦 is the admin of. */
const GRANDPARENTS_FAMILY: FamilyDetail = {
  id: '3c9e5a17-8b2d-4f6e-a1c3-5d7f9b0e2a48',
  name: '爷爷奶奶家',
  timezone: 'Asia/Shanghai',
  code: 'Q3M7XA',
  role: 'admin',
  members: [
    { parentId: LINYUE.id, name: '林悦', email: 'linyue@example.com', role: 'admin', you: true },
  ],
};

/** 林悦 as the design draws her when she cannot delete her account: the admin of two families. */
const LINYUE_RUNNING_TWO: MeResponse = {
  ...LINYUE,
  families: [
    { id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 0 },
    { id: GRANDPARENTS_FAMILY.id, name: '爷爷奶奶家', role: 'admin', pendingRequests: 0 },
  ],
};

/** 周子航 made the admin of 林悦的家 meanwhile, as the api answers after a refused deletion. */
const ZIHANG_NOW_ADMIN: MeResponse = {
  ...ZIHANG,
  families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 0 }],
};

/** Answers `PATCH /api/me` with the parent renamed, and records the bodies it got. */
function stubRename(): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http.patch('/api/me', async ({ request }) => {
      const body = (await request.json()) as { name: string };
      bodies.push(body);
      return HttpResponse.json({ ...ZIHANG, name: body.name });
    }),
  );
  return bodies;
}

const nameBox = () => screen.getByRole('textbox', { name: '名字' });
const deleteButton = () => screen.getByRole<HTMLButtonElement>('button', { name: '删除账号' });

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

/** Opens the question before deleting the account. */
function askToDelete(): Promise<HTMLElement> {
  return openDialog('删除账号', '删除你的账号？');
}

/**
 * Opens the profile page, asks to delete the account and confirms, and
 * answers the full-page navigations that followed.
 */
async function confirmDeletion(): Promise<string[]> {
  const { fixture, navigations } = await renderApp('/profile');
  const dialog = await askToDelete();
  await userEvent.click(within(dialog).getByRole('button', { name: '删除账号' }));
  await fixture.whenStable();
  return navigations;
}

// The profile screens are drawn for 周子航, a member of 林悦的家 without an
// email; the admin who cannot delete the account and the parent without a
// family are drawn for 林悦.
describe('Profile', () => {
  beforeEach(() => {
    stubSignedIn(ZIHANG, [LINYUE_FAMILY_FOR_ZIHANG]);
  });

  it('shows the name, — for no email, signing out and deleting the account', async () => {
    await renderApp('/profile');

    expect(document.title).toBe('个人设置 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '个人设置' })).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByRole('button', { name: '改名字' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(deleteButton().disabled).toBe(false);
    expect(screen.queryByRole('link', { name: '返回' })).toBeNull();
    expect(screen.getByRole('link', { name: '个人设置' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('profile');
  });

  it('shows the email the identity provider gave', async () => {
    worker.use(
      http.get('/api/me', () => HttpResponse.json({ ...ZIHANG, email: 'zihang@example.com' })),
    );
    await renderApp('/profile');

    expect(screen.getByText('zihang@example.com')).toBeTruthy();
  });

  it('edits the name in place with a mouse, starting from the current name', async () => {
    await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((nameBox() as HTMLInputElement).value).toBe('周子航');
    expect(document.activeElement).toBe(nameBox());
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('profile-edit-name', undefined, {
      prepare: startOver,
    });
  });

  it('saves a new name, shows it everywhere and says 已保存', async () => {
    const bodies = stubRename();
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), '  周小航 ');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(bodies).toEqual([{ name: '周小航' }]);
    await noNameBox();
    expect(screen.getAllByText('周小航').length).toBeGreaterThan(1);
    expect(await screen.findByText('已保存')).toBeTruthy();
  });

  it('saves with Enter and cancels with Escape', async () => {
    stubRename();
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号');
    await userEvent.keyboard('{Escape}');
    await noNameBox();
    expect(screen.queryByText('周子航二号')).toBeNull();
    expect(screen.queryByText('已保存')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号{Enter}');
    await fixture.whenStable();

    await noNameBox();
    expect(screen.getAllByText('周子航二号').length).toBeGreaterThan(0);
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
    const name = `${'周'.repeat(19)}👩‍👧`;

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

  it.each([
    ['the server fails', 500, 'internal'],
    ['the request is refused as coming from another site', 403, 'bad_origin'],
  ] as const)('keeps the typed name and shows a toast when %s', async (_case, status, code) => {
    stubError('patch /api/me', status, code);
    const { fixture } = await renderApp('/profile');

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.type(nameBox(), '二号');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect((nameBox() as HTMLInputElement).value).toBe('周子航二号');
    expect(screen.queryByText('已保存')).toBeNull();
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
      expect(box.value).toBe('周子航');

      await userEvent.type(box, '二号');
      await userEvent.click(within(sheet).getByRole('button', { name: '保存' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ name: '周子航二号' }]);
      await vi.waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(await screen.findByText('已保存')).toBeTruthy();
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
      expect(within(again).getByRole<HTMLInputElement>('textbox').value).toBe('周子航');
    });
  });

  describe('without a family', () => {
    beforeEach(() => {
      stubSignedIn(LINYUE_WITHOUT_FAMILY, []);
    });

    it('shows the page in the frame without menus, with 返回 at the top left', async () => {
      await renderApp('/profile');

      expect(screen.queryAllByRole('navigation')).toHaveLength(0);
      expect(screen.getByRole('heading', { level: 1, name: '个人设置' })).toBeTruthy();
      expect(screen.getByText('linyue@example.com')).toBeTruthy();
      expect(screen.getByRole('link', { name: '返回' }).getAttribute('href')).toBe('/start');
      expect(deleteButton().disabled).toBe(false);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('profile-no-family');
    });

    it('goes back to the start page with 返回', async () => {
      const { router, fixture } = await renderApp('/profile');

      await userEvent.click(screen.getByRole('link', { name: '返回' }));
      await fixture.whenStable();

      expect(router.url).toBe('/start');
    });

    it('asks before deleting the account without a family to leave', async () => {
      await renderApp('/profile');

      const dialog = await askToDelete();

      expect(dialog.textContent).toContain('你在好奇星球和 Authing 上的账号都会删掉，不能恢复。');
      expect(dialog.textContent).not.toContain('你会离开');
    });
  });

  describe('as the admin of families', () => {
    beforeEach(() => {
      stubSignedIn(LINYUE_RUNNING_TWO, [LINYUE_FAMILY, GRANDPARENTS_FAMILY]);
    });

    it('fades 删除账号, which cannot be pressed, and says which families to hand over first', async () => {
      await renderApp('/profile');

      const reason =
        '你还是「林悦的家」「爷爷奶奶家」的管理员，先把管理员设给别人或者删除家庭，才能删除账号';
      expect(deleteButton().disabled).toBe(true);
      expect(screen.getByText(reason).id).toBe(deleteButton().getAttribute('aria-describedby'));
      expect(screen.getByText('linyue@example.com')).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('profile-admin');
    });
  });

  describe('deleting the account', () => {
    it('asks first, naming the family the parent leaves, and changes nothing on 取消', async () => {
      const calls = recordCalls('delete', '/api/me', () => new HttpResponse(null, { status: 204 }));
      await renderApp('/profile');

      const dialog = await askToDelete();
      expect(dialog.textContent).toContain(
        '你会离开「林悦的家」。你在好奇星球和 Authing 上的账号都会删掉，不能恢复。',
      );
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-delete-account');
      await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      await dialogGone('删除你的账号？');

      expect(calls).toEqual([]);
    });

    it('deletes the account and opens the product home with 你的账号已删除', async () => {
      const calls = recordCalls('delete', '/api/me', () => new HttpResponse(null, { status: 204 }));

      const navigations = await confirmDeletion();

      expect(calls).toHaveLength(1);
      expect(navigations).toEqual(['/?account=deleted']);
    });

    it.each([
      ['Authing fails', () => stubError('delete /api/me', 502, 'identity_provider_failed')],
      ['the server fails', () => stubError('delete /api/me', 500, 'internal')],
      [
        'the request gets no answer',
        () => worker.use(http.delete('/api/me', () => HttpResponse.error())),
      ],
    ])('says 出了点问题 and stays when %s', async (_case, fail) => {
      fail();

      const navigations = await confirmDeletion();

      await expectToast('出了点问题，请稍后再试');
      await dialogGone('删除你的账号？');
      expect(navigations).toEqual([]);
      expect(deleteButton().disabled).toBe(false);
    });

    it('says so and fades the button when the parent was made an admin meanwhile', async () => {
      stubError('delete /api/me', 409, 'still_admin', {
        families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家' }],
      });
      worker.use(
        http.get('/api/me', () => HttpResponse.json(ZIHANG), { once: true }),
        http.get('/api/me', () => HttpResponse.json(ZIHANG_NOW_ADMIN)),
      );

      const navigations = await confirmDeletion();

      await expectToast('你还是家庭的管理员，先把管理员设给别人');
      await vi.waitFor(() => {
        expect(deleteButton().disabled).toBe(true);
      });
      expect(
        screen.getByText(
          '你还是「林悦的家」的管理员，先把管理员设给别人或者删除家庭，才能删除账号',
        ),
      ).toBeTruthy();
      expect(navigations).toEqual([]);
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
