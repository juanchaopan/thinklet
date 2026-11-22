import { screen, within } from '@testing-library/angular';
import type { ApplicantJoinRequest } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import {
  GRANDMA_CODE,
  findFamily,
  noDialog,
  sendRequest,
  stubFamilyCodes,
  stubSendRequest,
} from '../../../testing/families';
import { worker } from '../../../testing/network';
import {
  APPROVED_REQUEST,
  EXPIRED_REQUEST,
  LINYUE,
  LINYUE_WITH_RESULTS,
  PENDING_REQUEST,
  REJECTED_REQUEST,
  stubError,
  stubJoinRequests,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

/** 林小雨, the admin of 小姨家. */
const XIAOYU_ID = 'a3c5e7f9-1b3d-4f5a-8b6c-7d9e1f3a5b06';

/** The request to 小姨家 that sending one makes. */
const SENT: ApplicantJoinRequest = {
  id: '6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e96',
  familyName: '小姨家',
  familyTimezone: 'Asia/Shanghai',
  adminName: '林小雨',
  status: 'pending',
  createdAt: '2026-11-21T12:00:00Z',
};

/** 加入家庭 in the sidebar, with or without the red dot. */
const joinLink = () =>
  within(screen.getByRole('navigation', { name: '林悦' })).getByRole('link', {
    name: /^加入家庭/,
  });

async function renderJoin(requests: readonly ApplicantJoinRequest[], url = '/join', me = LINYUE) {
  stubSignedIn(me);
  stubJoinRequests(requests);
  return renderApp(url);
}

const cardTexts = () =>
  Array.from(document.querySelectorAll('[appcard]'), (card) =>
    card.textContent?.replace(/\s+/g, ''),
  );

describe('Join', () => {
  it("lists the parent's requests in every state, each with its one action", async () => {
    await renderJoin(
      [PENDING_REQUEST, APPROVED_REQUEST, REJECTED_REQUEST, EXPIRED_REQUEST],
      '/join',
      LINYUE_WITH_RESULTS,
    );

    expect(document.title).toBe('加入家庭 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '加入家庭' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '申请加入家庭' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '我的申请' })).toBeTruthy();
    expect(cardTexts()).toEqual([
      '舅舅家等待中管理员王建华·11月21日申请撤回',
      '外婆家已同意管理员周秀英·11月18日申请知道了',
      '周家被拒绝管理员周子航·11月15日申请知道了',
      '姑姑家已失效管理员林美华·11月6日申请家庭码已更换知道了',
    ]);
    expect(joinLink().getAttribute('aria-current')).toBe('page');
    expect(joinLink().querySelector('[appDot]')).not.toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('join-requests');
  });

  it('says 还没有发出过申请 without requests', async () => {
    await renderJoin([]);

    expect(screen.getByRole('heading', { level: 2, name: '我的申请' })).toBeTruthy();
    expect(screen.getByText('还没有发出过申请')).toBeTruthy();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('join-requests-empty');
  });

  it('takes a dismissed result off, and the red dot with the last one', async () => {
    worker.use(
      http.post('/api/join-requests/:requestId/dismiss', () => {
        worker.use(http.get('/api/me', () => HttpResponse.json(LINYUE)));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { fixture } = await renderJoin([APPROVED_REQUEST], '/join', LINYUE_WITH_RESULTS);

    await userEvent.click(screen.getByRole('button', { name: '知道了' }));
    await fixture.whenStable();

    expect(await screen.findByText('还没有发出过申请')).toBeTruthy();
    await vi.waitFor(() => {
      expect(joinLink().querySelector('[appDot]')).toBeNull();
    });
  });

  it('asks to join from 申请加入家庭, and lists the request sent', async () => {
    stubFamilyCodes({
      [GRANDMA_CODE]: { familyName: '小姨家', adminName: '林小雨', adminId: XIAOYU_ID },
    });
    stubSendRequest(SENT);
    const { fixture } = await renderJoin([REJECTED_REQUEST]);

    await userEvent.click(screen.getByRole('button', { name: '申请加入家庭' }));
    await screen.findByRole('dialog', { name: '申请加入家庭' });
    await sendRequest(await findFamily());
    await fixture.whenStable();

    expect(await screen.findByText('申请已发出')).toBeTruthy();
    await noDialog();
    expect(cardTexts()).toEqual([
      '小姨家等待中管理员林小雨·11月21日申请撤回',
      '周家被拒绝管理员周子航·11月15日申请知道了',
    ]);
  });

  it('opens an invitation link over the join page, and goes back to /join when it closes', async () => {
    stubFamilyCodes();
    const { router, fixture } = await renderJoin([], `/join/${GRANDMA_CODE}`);

    const dialog = await screen.findByRole('dialog', { name: '申请加入这个家庭？' });
    expect(within(dialog).getByText('外婆家')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: '加入家庭' })).toBeTruthy();
    expect(document.title).toBe('加入家庭 - 好奇星球');

    await userEvent.click(within(dialog).getByRole('button', { name: '换一个家庭码' }));
    await userEvent.click(await screen.findByRole('button', { name: '取消' }));

    await noDialog();
    await vi.waitFor(() => {
      expect(router.url).toBe('/join');
    });
    await fixture.whenStable();
  });

  it('reads the requests again when the window comes back to the front', async () => {
    const { fixture } = await renderJoin([]);
    stubJoinRequests([EXPIRED_REQUEST]);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(await screen.findByText('家庭码已更换')).toBeTruthy();
    await fixture.whenStable();
  });

  it('says the page did not open when the requests cannot be read', async () => {
    stubSignedIn();
    stubError('get /api/join-requests', 503, 'internal');
    await renderApp('/join');

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
