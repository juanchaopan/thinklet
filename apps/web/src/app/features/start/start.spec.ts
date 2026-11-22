import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import type { ApplicantJoinRequest } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { settleAnimations } from '../../../testing/animations';
import { renderApp } from '../../../testing/app';
import {
  GRANDMA_CODE,
  boxValues,
  browserIn,
  findFamily,
  holdOverlaysAt,
  noDialog,
  sendRequest,
  stubFamilyCodes,
  stubSendRequest,
  typeCode,
} from '../../../testing/families';
import { worker } from '../../../testing/network';
import {
  ERROR_NUMBER,
  EXPIRED_REQUEST,
  GRANDMA_FAMILY_ID,
  LINYUE_WITHOUT_FAMILY,
  PENDING_REQUEST,
  REJECTED_REQUEST,
  errorBody,
  stubError,
  stubJoinRequests,
  stubSignedIn,
  stubVisitor,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { FamilyCreation } from '../../core/family-creation';

/** The request to join 外婆家 that sending one makes. */
const SENT: ApplicantJoinRequest = {
  id: '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d85',
  familyName: '外婆家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '周秀英',
  status: 'pending',
  createdAt: '2026-11-21T12:00:00Z',
};

/** 林悦 without a family, with a request result she has not seen. */
const WITH_RESULTS = { ...LINYUE_WITHOUT_FAMILY, requestResults: 1 };

/** Opens the start page of 林悦 without a family, with her requests, in Shanghai. */
async function renderStart(
  requests: readonly ApplicantJoinRequest[] = [],
  url = '/start',
  me = LINYUE_WITHOUT_FAMILY,
) {
  stubSignedIn(me, []);
  stubJoinRequests(requests);
  return renderApp(url, { providers: [browserIn('Asia/Shanghai')] });
}

const choice = (name: RegExp) => screen.getByRole('button', { name });

/** The card of the request to the family with this name. */
function card(familyName: string): HTMLElement {
  const name = screen.getByText(familyName, { selector: 'span' });
  const found = name.closest<HTMLElement>('[appcard]');
  if (!found) {
    throw new Error(`No card for ${familyName}`);
  }
  return found;
}

const cardText = (familyName: string) => card(familyName).textContent?.replace(/\s+/g, '');

/** The toasts on screen. */
const toastCount = () => document.querySelector('app-toast-outlet')?.childElementCount ?? 0;

async function openJoinDialog(): Promise<HTMLElement> {
  await userEvent.click(choice(/^申请加入家庭/));
  return screen.findByRole('dialog', { name: '申请加入家庭' });
}

/** Opens the start page and asks to join 外婆家 with its code, sending the request. */
async function askGrandma() {
  const view = await renderStart();
  await openJoinDialog();
  await sendRequest(await findFamily());
  await view.fixture.whenStable();
  return view;
}

/** Records the requests that are read, answering each with the next list given (the last one after that). */
function stubRequestReads(...lists: Array<readonly ApplicantJoinRequest[]>): { reads: number } {
  const counter = { reads: 0 };
  worker.use(
    http.get('/api/join-requests', () => {
      const list = lists[Math.min(counter.reads, lists.length - 1)] ?? [];
      counter.reads++;
      return HttpResponse.json(list);
    }),
  );
  return counter;
}

describe('Start', () => {
  it('welcomes the parent and offers to create a family or to ask to join one', async () => {
    await renderStart();

    expect(document.title).toBe('开始 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '欢迎，林悦' })).toBeTruthy();
    expect(screen.getByText('先创建或加入一个家庭。')).toBeTruthy();
    expect(choice(/^创建家庭\s*你来当管理员$/)).toBeTruthy();
    expect(choice(/^申请加入家庭\s*用家人给的家庭码$/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '我的申请' })).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('start');
  });

  it('lists the requests above the two ways to a family, newest first', async () => {
    await renderStart([PENDING_REQUEST, REJECTED_REQUEST], '/start', WITH_RESULTS);

    expect(screen.getByRole('heading', { level: 2, name: '我的申请' })).toBeTruthy();
    expect(screen.queryByText('先创建或加入一个家庭。')).toBeNull();
    expect(cardText('舅舅家')).toBe('舅舅家等待中管理员王建华·11月21日申请撤回');
    expect(cardText('周家')).toBe('周家被拒绝管理员周子航·11月15日申请知道了');
    expect(screen.getByRole('button', { name: /的菜单\s*，有新的申请结果$/ })).toBeTruthy();
    const order = screen.getAllByText(/^(舅舅家|周家)$/).map((name) => name.textContent);
    expect(order).toEqual(['舅舅家', '周家']);
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('start-waiting');
  });

  it('says a request expired because the family code was changed', async () => {
    await renderStart([EXPIRED_REQUEST], '/start', WITH_RESULTS);

    expect(cardText('姑姑家')).toBe('姑姑家已失效管理员林美华·11月6日申请家庭码已更换知道了');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('start-expired');
  });

  it('withdraws a waiting request: the card goes, without a toast', async () => {
    const withdrawn: string[] = [];
    worker.use(
      http.delete('/api/join-requests/:requestId', ({ params }) => {
        withdrawn.push(String(params['requestId']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { fixture } = await renderStart([PENDING_REQUEST, REJECTED_REQUEST]);

    await userEvent.click(within(card('舅舅家')).getByRole('button', { name: '撤回' }));
    await fixture.whenStable();

    expect(withdrawn).toEqual([PENDING_REQUEST.id]);
    expect(screen.queryByText('舅舅家')).toBeNull();
    expect(screen.getByText('周家')).toBeTruthy();
    expect(toastCount()).toBe(0);
  });

  it('says a request was handled meanwhile when it can no longer be withdrawn, and reads them again', async () => {
    stubError('delete /api/join-requests/:requestId', 409, 'request_closed');
    const { fixture } = await renderStart([PENDING_REQUEST]);
    const reads = stubRequestReads([{ ...PENDING_REQUEST, status: 'approved' }]);

    await userEvent.click(within(card('舅舅家')).getByRole('button', { name: '撤回' }));
    await fixture.whenStable();

    expect(await screen.findByText('这个申请已经处理过了')).toBeTruthy();
    await vi.waitFor(() => {
      expect(cardText('舅舅家')).toContain('已同意');
    });
    expect(reads.reads).toBe(1);
  });

  it('dismisses a result: the card goes and the red dot is read again', async () => {
    const dismissed: string[] = [];
    worker.use(
      http.post('/api/join-requests/:requestId/dismiss', ({ params }) => {
        dismissed.push(String(params['requestId']));
        worker.use(http.get('/api/me', () => HttpResponse.json(LINYUE_WITHOUT_FAMILY)));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { fixture } = await renderStart(
      [PENDING_REQUEST, REJECTED_REQUEST],
      '/start',
      WITH_RESULTS,
    );

    await userEvent.click(within(card('周家')).getByRole('button', { name: '知道了' }));
    await fixture.whenStable();

    expect(dismissed).toEqual([REJECTED_REQUEST.id]);
    expect(screen.queryByText('周家')).toBeNull();
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /^林悦\s*的菜单$/ })).toBeTruthy();
    });
  });

  it('says a request is gone when it is not there any more, and reads them again', async () => {
    stubError('post /api/join-requests/:requestId/dismiss', 404, 'not_found');
    const { fixture } = await renderStart([REJECTED_REQUEST]);
    stubRequestReads([]);

    await userEvent.click(within(card('周家')).getByRole('button', { name: '知道了' }));
    await fixture.whenStable();

    expect(await screen.findByText('这个申请已经不在了')).toBeTruthy();
    await vi.waitFor(() => {
      expect(screen.queryByText('周家')).toBeNull();
    });
  });

  it.each([
    ['the request is still waiting', 409, 'request_pending'],
    ['the server fails', 500, 'internal'],
  ] as const)('keeps the card and shows a toast when %s', async (_case, status, code) => {
    stubError('post /api/join-requests/:requestId/dismiss', status, code);
    const { fixture } = await renderStart([REJECTED_REQUEST]);

    await userEvent.click(within(card('周家')).getByRole('button', { name: '知道了' }));
    await fixture.whenStable();

    expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
    expect(within(card('周家')).getByRole<HTMLButtonElement>('button').disabled).toBe(false);
  });

  it('reads the requests again when the window comes back to the front', async () => {
    const { fixture } = await renderStart();
    stubRequestReads([REJECTED_REQUEST]);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByText('周家')).toBeTruthy();
    await fixture.whenStable();
  });

  it('opens the home page of a family the parent was let into meanwhile, and says so', async () => {
    const { router, fixture } = await renderStart([PENDING_REQUEST]);
    worker.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ...WITH_RESULTS,
          families: [{ id: GRANDMA_FAMILY_ID, name: '外婆家', role: 'member' }],
        }),
      ),
    );

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => {
      expect(router.url).toBe('/');
    });
    expect(await screen.findByText('你已加入「外婆家」')).toBeTruthy();
    expect(localStorage.getItem('thinklet.currentFamilyId')).toBe(GRANDMA_FAMILY_ID);
    expect(screen.getAllByRole('button', { name: /外婆家/ }).length).toBeGreaterThan(0);
    await fixture.whenStable();
  });

  it('says the page did not open when the requests cannot be read, and retries', async () => {
    stubSignedIn(LINYUE_WITHOUT_FAMILY, []);
    stubError('get /api/join-requests', 500, 'internal');
    const { fixture } = await renderApp('/start');

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();

    stubJoinRequests([PENDING_REQUEST]);
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    await fixture.whenStable();

    expect(await screen.findByText('舅舅家')).toBeTruthy();
  });

  describe('creating a family', () => {
    it('opens the dialog with the suggested name and the time zone of where the browser is', async () => {
      await renderStart();

      await userEvent.click(choice(/^创建家庭/));
      const dialog = await screen.findByRole('dialog', { name: '创建家庭' });

      expect(
        within(dialog).getByRole<HTMLInputElement>('textbox', { name: '家庭名称' }).value,
      ).toBe('林悦的家');
      expect(within(dialog).getByRole('button', { name: /^时区/ }).textContent?.trim()).toBe(
        'Asia/Shanghai（UTC+08:00）',
      );
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-create');
    });

    it('will not create a family without a name: the box shakes and says so', async () => {
      await renderStart();
      await userEvent.click(choice(/^创建家庭/));
      const dialog = await screen.findByRole('dialog', { name: '创建家庭' });
      const name = within(dialog).getByRole('textbox', { name: '家庭名称' });

      await userEvent.clear(name);
      const create = within(dialog).getByRole('button', { name: '创建' });
      await userEvent.click(create);
      await userEvent.unhover(create);

      expect(within(dialog).getByText('请填家庭名称')).toBeTruthy();
      expect(name.getAttribute('aria-invalid')).toBe('true');
      expect(name.classList).toContain('animate-shake');
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-create-error');
    });

    it.each([0, 100, 300])(
      'opens with the backdrop and the rising panel, at %i ms',
      async (time) => {
        await renderStart();
        const creation = TestBed.inject(FamilyCreation);

        await expectScreenshotsAtEverySize(
          `family-create-opening-${String(time).padStart(4, '0')}ms`,
          undefined,
          {
            prepare: async () => {
              creation.done();
              await noDialog();
              settleAnimations();
              creation.request();
              await screen.findByRole('dialog', { name: '创建家庭' });
              await holdOverlaysAt(time);
            },
          },
        );
      },
    );

    it('lands on the home page of the new family, which the parent runs, with 已创建', async () => {
      const bodies: unknown[] = [];
      worker.use(
        http.post('/api/families', async ({ request }) => {
          bodies.push(await request.json());
          worker.use(
            http.get('/api/me', () =>
              HttpResponse.json({
                ...LINYUE_WITHOUT_FAMILY,
                families: [
                  { id: GRANDMA_FAMILY_ID, name: '林悦的家', role: 'admin', pendingRequests: 0 },
                ],
              }),
            ),
          );
          return HttpResponse.json(
            {
              id: GRANDMA_FAMILY_ID,
              name: '林悦的家',
              timezone: 'Asia/Shanghai',
              code: GRANDMA_CODE,
              role: 'admin',
              members: [],
            },
            { status: 201 },
          );
        }),
      );
      const { router, fixture } = await renderStart();

      await userEvent.click(choice(/^创建家庭/));
      const dialog = await screen.findByRole('dialog', { name: '创建家庭' });
      await userEvent.click(within(dialog).getByRole('button', { name: '创建' }));
      await fixture.whenStable();

      expect(bodies).toEqual([{ name: '林悦的家', timezone: 'Asia/Shanghai' }]);
      await vi.waitFor(() => {
        expect(router.url).toBe('/');
      });
      expect(await screen.findByText('已创建「林悦的家」')).toBeTruthy();
      expect(screen.getByText('欢迎回来，林悦')).toBeTruthy();
      expect(screen.getAllByRole('link', { name: /新成员/ }).length).toBeGreaterThan(0);
      await noDialog();
    });
  });

  describe('asking to join a family', () => {
    it('opens the dialog with six boxes, the focus moving on as the code is typed', async () => {
      await renderStart();

      const dialog = await openJoinDialog();
      await typeCode('7kq');

      expect(boxValues()).toEqual(['7', 'K', 'Q', '', '', '']);
      expect(within(dialog).queryByRole('button', { name: /下一步/ })).toBeNull();
      expect(within(dialog).getByRole('button', { name: '取消' })).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-join');
    });

    it('looks the code up once the sixth box is filled, and says when there is no such code', async () => {
      const asked = stubFamilyCodes();
      await renderStart();

      await openJoinDialog();
      await typeCode('7KQ4MW');

      expect(await screen.findByText('没有这个家庭码')).toBeTruthy();
      expect(asked).toEqual(['7KQ4MW']);
      expect(screen.getByRole('group', { name: '家庭码，6 位' }).classList).toContain(
        'animate-shake',
      );
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-join-error');
    });

    it('shows the family found and its admin, to confirm before sending', async () => {
      stubFamilyCodes();
      await renderStart();

      await openJoinDialog();
      const dialog = await findFamily();

      expect(within(dialog).getByText('外婆家')).toBeTruthy();
      expect(within(dialog).getByText('管理员 周秀英')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: '换一个家庭码' })).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: '发送申请' })).toBeTruthy();
      await vi.waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('family-join-confirm');
    });

    it.each([
      ['a family the parent is in', 'already_member', '你已经是这个家庭的成员'],
      ['a family the parent has asked to join', 'request_pending', '你已经申请过了，等管理员处理'],
    ] as const)('says so under the boxes for %s', async (_case, code, hint) => {
      stubError('get /api/family-codes/:code', 409, code);
      await renderStart();

      await openJoinDialog();
      await typeCode(GRANDMA_CODE);

      expect(await screen.findByText(hint)).toBeTruthy();
    });

    it('lets a changed box look the code up again', async () => {
      const asked = stubFamilyCodes();
      await renderStart();

      await openJoinDialog();
      await typeCode('7KQ4MW');
      await screen.findByText('没有这个家庭码');
      await userEvent.keyboard('{Backspace}z');

      expect(await screen.findByRole('dialog', { name: '申请加入这个家庭？' })).toBeTruthy();
      expect(asked).toEqual(['7KQ4MW', GRANDMA_CODE]);
    });

    it('sends the request: the dialog closes with 申请已发出 and the request is listed', async () => {
      stubFamilyCodes();
      const bodies = stubSendRequest(SENT);

      await askGrandma();

      expect(bodies).toEqual([{ code: GRANDMA_CODE }]);
      expect(await screen.findByText('申请已发出')).toBeTruthy();
      await noDialog();
      expect(cardText('外婆家')).toBe('外婆家等待中管理员周秀英·11月21日申请撤回');
    });

    it('goes back to the boxes, which say why, when the request is turned down', async () => {
      stubFamilyCodes();
      worker.use(
        http.post('/api/join-requests', () =>
          HttpResponse.json(errorBody('request_pending'), { status: 409 }),
        ),
      );

      await askGrandma();

      expect(await screen.findByText('你已经申请过了，等管理员处理')).toBeTruthy();
      expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
    });

    it('keeps the family and shows a toast when sending fails', async () => {
      stubFamilyCodes();
      stubError('post /api/join-requests', 500, 'internal');

      await askGrandma();

      expect(await screen.findByText('出了点问题，请稍后再试')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: '申请加入这个家庭？' })).toBeTruthy();
    });

    it('empties the boxes with 换一个家庭码', async () => {
      stubFamilyCodes();
      await renderStart();

      await openJoinDialog();
      const dialog = await findFamily();
      await userEvent.click(within(dialog).getByRole('button', { name: '换一个家庭码' }));

      expect(await screen.findByRole('dialog', { name: '申请加入家庭' })).toBeTruthy();
      expect(boxValues()).toEqual(['', '', '', '', '', '']);
      await typeCode('7');
    });

    it('closes with 取消 and starts over next time', async () => {
      await renderStart();

      await openJoinDialog();
      await typeCode('7KQ');
      await userEvent.click(screen.getByRole('button', { name: '取消' }));
      await noDialog();
      await openJoinDialog();

      expect(boxValues()).toEqual(['', '', '', '', '', '']);
    });
  });

  describe('opened from an invitation link', () => {
    it('shows the family of the code in the link at once, over the start page', async () => {
      const asked = stubFamilyCodes();
      const { router } = await renderStart([], '/join/7kq4mz');

      expect(await screen.findByRole('dialog', { name: '申请加入这个家庭？' })).toBeTruthy();
      expect(asked).toEqual([GRANDMA_CODE]);
      expect(router.url).toBe('/join/7kq4mz');
      expect(document.title).toBe('开始 - 好奇星球');
      expect(screen.getByRole('heading', { level: 1, name: '欢迎，林悦' })).toBeTruthy();
    });

    it('goes back to /start when the dialog closes', async () => {
      stubFamilyCodes();
      const { router, fixture } = await renderStart([], `/join/${GRANDMA_CODE}`);
      const dialog = await screen.findByRole('dialog', { name: '申请加入这个家庭？' });
      await vi.waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });

      await userEvent.keyboard('{Escape}');

      await noDialog();
      await vi.waitFor(() => {
        expect(router.url).toBe('/start');
      });
      await fixture.whenStable();
    });

    it('fills the boxes by the same rules as typing', async () => {
      await renderStart([], '/join/7k0q');

      await screen.findByRole('dialog', { name: '申请加入家庭' });

      expect(boxValues()).toEqual(['7', 'K', 'Q', '', '', '']);
    });

    it('sends a visitor to sign in first, coming back to the link', async () => {
      stubVisitor();
      const { router } = await renderApp(`/join/${GRANDMA_CODE}`);

      expect(router.url).toBe(`/?returnTo=${encodeURIComponent(`/join/${GRANDMA_CODE}`)}`);
      expect(screen.getByRole('link', { name: '家长登录 / 注册' }).getAttribute('href')).toBe(
        `/api/auth/login?returnTo=${encodeURIComponent(`/join/${GRANDMA_CODE}`)}`,
      );
    });
  });
});
