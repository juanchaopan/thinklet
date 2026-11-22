import { screen, within } from '@testing-library/angular';
import type { FamilyDetail } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../testing/accessibility';
import { settleAnimations } from '../../testing/animations';
import { renderApp } from '../../testing/app';
import { browserIn, noDialog } from '../../testing/families';
import { worker } from '../../testing/network';
import { emulateTouch } from '../../testing/pointer';
import { LINYUE, errorBody, stubError, stubSignedIn } from '../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../testing/screenshots';
import { VIEWPORTS } from '../../testing/viewports';
import { familyNameHint, suggestedFamilyName } from './create-family-dialog';

const MINUS = '−';

const NEW_FAMILY_ID = 'c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e77';

/** The family the api creates from a request body. */
function created(body: { name: string; timezone: string }): FamilyDetail {
  return {
    id: NEW_FAMILY_ID,
    name: body.name,
    timezone: body.timezone,
    code: 'H8P2RW',
    role: 'admin',
    members: [],
  };
}

/**
 * Answers `POST /api/families` with the new family, after which `/api/me`
 * lists it as the parent's last family; records the bodies it got.
 */
function stubCreate(): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http.post('/api/families', async ({ request }) => {
      const body = (await request.json()) as { name: string; timezone: string };
      bodies.push(body);
      worker.use(
        http.get('/api/me', () =>
          HttpResponse.json({
            ...LINYUE,
            families: [
              ...LINYUE.families,
              { id: NEW_FAMILY_ID, name: body.name, role: 'admin', pendingRequests: 0 },
            ],
          }),
        ),
      );
      return HttpResponse.json(created(body), { status: 201 });
    }),
  );
  return bodies;
}

/** Opens 林悦's home page, with the browser in the given time zone. */
async function renderHome(timeZone: string | null = 'Asia/Shanghai', url = '/') {
  return renderApp(url, { providers: [browserIn(timeZone)] });
}

/** Opens the dialog from 创建家庭 at the bottom of the family menu. */
async function openFromMenu(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: /切换家庭$/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: '创建家庭' }));
  return screen.findByRole('dialog', { name: '创建家庭' });
}

const nameBox = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLInputElement>('textbox', { name: '家庭名称' });

const timeZoneField = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^时区/ });

async function create(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole('button', { name: '创建' }));
}

describe('familyNameHint', () => {
  it.each([
    ['', '请填家庭名称'],
    ['   ', '请填家庭名称'],
    ['一二三四五六七八九十一二三四五六七八九十一', '家庭名称最多 20 个字'],
  ])('turns down %j with %s', (name, hint) => {
    expect(familyNameHint(name)).toBe(hint);
  });

  it('takes 1 to 20 characters of any kind, counting an emoji as one', () => {
    expect(familyNameHint('家')).toBeNull();
    expect(familyNameHint(`${'家'.repeat(19)}👨‍👩‍👧`)).toBeNull();
  });
});

describe('suggestedFamilyName', () => {
  it("is the parent's name with 的家", () => {
    expect(suggestedFamilyName('林悦')).toBe('林悦的家');
  });

  it('is empty when that would pass 20 characters', () => {
    expect(suggestedFamilyName('一二三四五六七八九十一二三四五六七八')).toBe(
      '一二三四五六七八九十一二三四五六七八的家',
    );
    expect(suggestedFamilyName('一二三四五六七八九十一二三四五六七八九')).toBe('');
  });
});

describe('CreateFamilyDialog', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('opens over the page from 创建家庭 in the family menu', async () => {
    await renderHome();

    const dialog = await openFromMenu();

    expect(nameBox(dialog).value).toBe('林悦的家');
    expect(timeZoneField(dialog).textContent?.trim()).toBe('Asia/Shanghai（UTC+08:00）');
    expect(screen.getByText('欢迎回来，林悦')).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('family-create-from-menu');
  });

  it('creates the family: it is the current one in the menu and its home page opens with 已创建', async () => {
    const bodies = stubCreate();
    const { router, fixture } = await renderHome('Asia/Shanghai', '/join');

    const dialog = await openFromMenu();
    await userEvent.fill(nameBox(dialog), '  小林的家 ');
    await create(dialog);
    await fixture.whenStable();

    expect(bodies).toEqual([{ name: '小林的家', timezone: 'Asia/Shanghai' }]);
    await noDialog();
    expect(router.url).toBe('/');
    expect(await screen.findByText('已创建「小林的家」')).toBeTruthy();
    expect(localStorage.getItem('thinklet.currentFamilyId')).toBe(NEW_FAMILY_ID);
    await userEvent.click(screen.getByRole('button', { name: '小林的家 切换家庭' }));
    const menu = await screen.findByRole('menu', { name: '切换家庭' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.replace(/\s+/g, '')),
    ).toEqual(['林悦的家管理员', '外婆家', '小林的家管理员', '创建家庭']);
  });

  it('creates the family in the time zone the parent picks', async () => {
    const bodies = stubCreate();
    const { fixture } = await renderHome();

    const dialog = await openFromMenu();
    await userEvent.click(timeZoneField(dialog));
    await screen.findByRole('dialog', { name: '选择时区' });
    await userEvent.keyboard('america/toronto{Enter}');
    await vi.waitFor(() => {
      expect(timeZoneField(dialog).textContent?.trim()).toBe(`America/Toronto（UTC${MINUS}05:00）`);
    });
    await create(dialog);
    await fixture.whenStable();

    expect(bodies).toEqual([{ name: '林悦的家', timezone: 'America/Toronto' }]);
  });

  it('takes the standard name of a time zone the browser reports by an old one', async () => {
    const bodies = stubCreate();
    const { fixture } = await renderHome('Asia/Kolkata');

    const dialog = await openFromMenu();
    await create(dialog);
    await fixture.whenStable();

    expect(bodies).toEqual([{ name: '林悦的家', timezone: 'Asia/Kolkata' }]);
  });

  it('asks for a time zone when the browser reports none', async () => {
    await renderHome(null);

    const dialog = await openFromMenu();
    expect(timeZoneField(dialog).textContent?.trim()).toBe('');
    await create(dialog);

    expect(within(dialog).getByText('请选择时区')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it.each([
    ['only spaces', '   ', '请填家庭名称'],
    ['21 characters', '一二三四五六七八九十一二三四五六七八九十一', '家庭名称最多 20 个字'],
  ])('will not create a family named with %s', async (_case, name, hint) => {
    await renderHome();

    const dialog = await openFromMenu();
    await userEvent.fill(nameBox(dialog), name);
    await create(dialog);

    expect(within(dialog).getByText(hint)).toBeTruthy();
    expect(nameBox(dialog).getAttribute('aria-invalid')).toBe('true');
  });

  it('creates a family of 20 characters, counting an emoji as one', async () => {
    const bodies = stubCreate();
    const { fixture } = await renderHome();
    const name = `${'家'.repeat(19)}👨‍👩‍👧`;

    const dialog = await openFromMenu();
    await userEvent.fill(nameBox(dialog), name);
    await create(dialog);
    await fixture.whenStable();

    expect(bodies).toEqual([{ name, timezone: 'Asia/Shanghai' }]);
  });

  it('creates with Enter in the name box', async () => {
    const bodies = stubCreate();
    const { fixture } = await renderHome();

    const dialog = await openFromMenu();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(nameBox(dialog));
    });
    await userEvent.keyboard('{Enter}');
    await fixture.whenStable();

    expect(bodies).toHaveLength(1);
  });

  it('starts with an empty name for a parent whose name would make it too long', async () => {
    stubSignedIn({ ...LINYUE, name: '一二三四五六七八九十一二三四五六七八九' });
    await renderHome();

    const dialog = await openFromMenu();

    expect(nameBox(dialog).value).toBe('');
  });

  it('shows the hint for a field the server turns down', async () => {
    stubError('post /api/families', 400, 'invalid_request', {
      fields: [{ path: 'timezone', code: 'invalid' }],
    });
    const { fixture } = await renderHome();

    const dialog = await openFromMenu();
    await create(dialog);
    await fixture.whenStable();

    expect(await within(dialog).findByText('请选择时区')).toBeTruthy();
  });

  it.each([
    ['the server fails', () => stubError('post /api/families', 500, 'internal')],
    [
      'there is no answer',
      () => worker.use(http.post('/api/families', () => HttpResponse.error())),
    ],
  ])('keeps what was typed and shows a toast when %s', async (_case, stub) => {
    stub();
    const { fixture } = await renderHome();

    const dialog = await openFromMenu();
    await userEvent.fill(nameBox(dialog), '小林的家');
    await create(dialog);
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect(nameBox(dialog).value).toBe('小林的家');
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: '创建' }).disabled).toBe(
      false,
    );
  });

  it('sends once while the family is being created, however often it is asked', async () => {
    let calls = 0;
    let answer: (() => void) | undefined;
    worker.use(
      http.post('/api/families', async () => {
        calls++;
        await new Promise<void>((resolve) => {
          answer = resolve;
        });
        return HttpResponse.json(errorBody('internal'), { status: 500 });
      }),
    );
    const { fixture } = await renderHome();

    const dialog = await openFromMenu();
    await create(dialog);
    const busy = await within(dialog).findByRole<HTMLButtonElement>('button', {
      name: '创建中…',
    });
    expect(busy.disabled).toBe(true);
    await vi.waitFor(() => {
      expect(calls).toBe(1);
    });
    nameBox(dialog).focus();
    await userEvent.keyboard('{Enter}');
    answer?.();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    await fixture.whenStable();
    expect(calls).toBe(1);
  });

  it('closes with 取消, creating nothing, and starts over next time', async () => {
    await renderHome();

    let dialog = await openFromMenu();
    await userEvent.fill(nameBox(dialog), '小林的家');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await noDialog();
    dialog = await openFromMenu();

    expect(nameBox(dialog).value).toBe('林悦的家');
  });

  it('opens the time zone list as a second sheet over the first on a touch screen', async () => {
    await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    await emulateTouch(true);
    await renderHome();

    const dialog = await openFromMenu();
    await userEvent.click(timeZoneField(dialog));
    const picker = await screen.findByRole('dialog', { name: '选择时区' });
    settleAnimations();

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(VIEWPORTS.phone.height - picker.getBoundingClientRect().bottom).toBe(12);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
    expect(screen.getByRole('dialog', { name: '创建家庭' })).toBeTruthy();
  });
});
