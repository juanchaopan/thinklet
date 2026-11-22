import { screen, within } from '@testing-library/angular';
import type {
  FamilyJoinRequestsResponse,
  HandledJoinRequest,
  MeResponse,
} from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import {
  backToFront,
  expectToast,
  recordCalls,
  renderFamilyPage,
} from '../../../testing/family-page';
import { worker } from '../../../testing/network';
import {
  LINYUE,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  NEW_MEMBERS,
  ZIHANG,
  stubError,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { frameName, raiseStillToast, toastFrame } from '../../../testing/toasts';

const PAGE = `/families/${LINYUE_FAMILY_ID}/new-members`;
const REQUESTS_PATH = `/api/families/${LINYUE_FAMILY_ID}/join-requests`;

const [CHENXIAO, YIFAN] = NEW_MEMBERS.pending;
const [JIANGUO] = NEW_MEMBERS.handled;

/** 林悦 with the given number of requests waiting in her family. */
function linyueWaitingFor(count: number): MeResponse {
  return {
    ...LINYUE,
    families: LINYUE.families.map((family) =>
      family.id === LINYUE_FAMILY_ID ? { ...family, pendingRequests: count } : family,
    ),
  };
}

/** Answers the family's requests with the lists given, the last one from then on. */
function stubRequests(...lists: FamilyJoinRequestsResponse[]): { reads: number } {
  const counter = { reads: 0 };
  worker.use(
    http.get(REQUESTS_PATH, () => {
      const answer = lists[Math.min(counter.reads, lists.length - 1)] ?? NEW_MEMBERS;
      counter.reads++;
      return HttpResponse.json(answer);
    }),
  );
  return counter;
}

/** Answers deciding 陈晓's request with it handled, and the parent with one request less. */
function stubDecision(decision: 'approve' | 'reject', status: HandledJoinRequest['status']) {
  if (!CHENXIAO) {
    throw new Error('The sample has a waiting request');
  }
  const { id, parentId, name, email } = CHENXIAO;
  const handled: HandledJoinRequest = {
    id,
    parentId,
    name,
    email,
    status,
    closedAt: '2026-11-21T11:30:00Z',
  };
  return recordCalls('post', `${REQUESTS_PATH}/${CHENXIAO.id}/${decision}`, () => {
    worker.use(http.get('/api/me', () => HttpResponse.json(linyueWaitingFor(1))));
    return HttpResponse.json(handled);
  });
}

/** The row of the request of the applicant with the name, in the card with the heading. */
function row(card: '等你处理' | '处理过的', name: string): HTMLElement | null {
  const section = screen.getByRole('heading', { name: card }).closest('section');
  const item = section && within(section).queryByText(name)?.closest('li');
  return item ?? null;
}

async function renderNewMembers(lists: FamilyJoinRequestsResponse = NEW_MEMBERS, me = LINYUE) {
  stubRequests(lists);
  return renderFamilyPage(PAGE, { me });
}

describe('NewMembers', () => {
  it('lists the waiting requests and the handled ones with the times in the family time zone', async () => {
    await renderNewMembers();

    expect(document.title).toBe('新成员 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '新成员' })).toBeTruthy();
    expect(row('等你处理', '陈晓')?.textContent?.replace(/\s+/g, '')).toBe(
      '陈陈晓chenxiao@example.com·11月21日09:12拒绝同意',
    );
    expect(row('处理过的', '李想')?.textContent?.replace(/\s+/g, '')).toBe(
      '李李想已拒绝lixiang@example.com·11月10日知道了',
    );
    expect(row('处理过的', '赵琳')?.textContent).toContain('已失效');
    expect(row('等你处理', '陈晓')?.querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('new-members');
  });

  it('says there are no new requests, and leaves the handled card out when it is empty', async () => {
    await renderNewMembers({ pending: [], handled: [] }, linyueWaitingFor(0));

    expect(screen.getByText('没有新的申请')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '处理过的' })).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('new-members-empty');
  });

  it.each([
    { decision: 'approve', button: '同意', status: 'approved', label: '已同意' },
    { decision: 'reject', button: '拒绝', status: 'rejected', label: '已拒绝' },
  ] as const)(
    '$button: the row slides out and tops the handled ones, and the count pops',
    async ({ decision, button, status, label }) => {
      const calls = stubDecision(decision, status);
      const { fixture } = await renderNewMembers();
      const waiting = row('等你处理', '陈晓');

      await userEvent.click(within(waiting ?? document.body).getByRole('button', { name: button }));
      await fixture.whenStable();

      expect(calls).toHaveLength(1);
      expect(waiting?.classList).toContain('animate-slide-away');
      expect(row('处理过的', '陈晓')?.textContent).toContain(label);
      const handledNames = within(
        screen.getByRole('heading', { name: '处理过的' }).closest('section') ?? document.body,
      )
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[id]')?.textContent);
      expect(handledNames.slice(0, 2)).toEqual(['陈晓', JIANGUO?.name]);
      await vi.waitFor(() => {
        expect(row('等你处理', '陈晓')).toBeNull();
      });
      const badge = screen
        .getAllByRole('link', { name: /^新成员/ })[0]
        ?.querySelector('[appBadge]');
      await vi.waitFor(() => {
        expect(badge?.textContent).toBe('1');
      });
      expect(badge?.classList).toContain('animate-count');
      expect(screen.queryByText('出了点问题，请稍后再试')).toBeNull();
    },
  );

  it('clears a handled request with 知道了, without a word', async () => {
    const calls = recordCalls('post', `${REQUESTS_PATH}/${JIANGUO?.id ?? ''}/dismiss`, () => {
      return new HttpResponse(null, { status: 204 });
    });
    const { fixture } = await renderNewMembers();

    const handled = row('处理过的', '林建国');
    await userEvent.click(within(handled ?? document.body).getByRole('button', { name: '知道了' }));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await vi.waitFor(() => {
      expect(row('处理过的', '林建国')).toBeNull();
    });
    expect(document.querySelector('app-toast-outlet')?.childElementCount).toBe(0);
  });

  it.each([
    ['request_closed', 409, '这个申请已经失效了'],
    ['not_found', 404, '这个申请已经不在了'],
  ] as const)(
    'says why when the request changed meanwhile (%s), and lists the requests again',
    async (code, status, message) => {
      stubError(`post ${REQUESTS_PATH}/${CHENXIAO?.id ?? ''}/approve`, status, code);
      const reads = stubRequests(NEW_MEMBERS, { ...NEW_MEMBERS, pending: YIFAN ? [YIFAN] : [] });
      const { fixture } = await renderFamilyPage(PAGE);

      await userEvent.click(
        within(row('等你处理', '陈晓') ?? document.body).getByRole('button', { name: '同意' }),
      );
      await fixture.whenStable();

      await expectToast(message);
      await vi.waitFor(() => {
        expect(row('等你处理', '陈晓')).toBeNull();
      });
      expect(reads.reads).toBe(2);
    },
  );

  it('says 你已不是管理员 and goes to the family page when the role went elsewhere meanwhile', async () => {
    stubError(`post ${REQUESTS_PATH}/${CHENXIAO?.id ?? ''}/reject`, 403, 'not_admin');
    const { fixture, router } = await renderNewMembers();
    worker.use(
      http.get('/api/me', () =>
        HttpResponse.json({
          ...LINYUE,
          families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }],
        }),
      ),
    );

    await userEvent.click(
      within(row('等你处理', '陈晓') ?? document.body).getByRole('button', { name: '拒绝' }),
    );
    await fixture.whenStable();

    await expectToast('你已不是管理员');
    await vi.waitFor(() => {
      expect(router.url).toBe(`/families/${LINYUE_FAMILY_ID}`);
    });
  });

  it.each([0, 125, 250, 2500, 5250, 5400])(
    'keeps the request and says so in a toast when approving fails, at %i ms',
    async (time) => {
      stubError(`post ${REQUESTS_PATH}/${CHENXIAO?.id ?? ''}/approve`, 500, 'internal');
      const { fixture } = await renderNewMembers();
      const approve = within(row('等你处理', '陈晓') ?? document.body).getByRole('button', {
        name: '同意',
      });

      await raiseStillToast(async () => {
        await userEvent.click(approve);
        await fixture.whenStable();
      }, '出了点问题，请稍后再试');
      await userEvent.unhover(approve);

      expect(row('等你处理', '陈晓')?.classList).not.toContain('animate-slide-away');
      await expectScreenshotsAtEverySize(
        `toast-action-error-${frameName(time)}`,
        undefined,
        toastFrame(time, 'error'),
      );
    },
  );

  it('shows 99+ on 新成员 past 99 waiting requests', async () => {
    await renderNewMembers(NEW_MEMBERS, linyueWaitingFor(120));

    const menus = document.querySelectorAll('nav[aria-label="主菜单"]');
    const counts = Array.from(menus, (menu) => menu.querySelector('[appBadge]')?.textContent);

    expect(counts).toEqual(['99+', '99+']);
  });

  it('reads the requests again when the window comes back to the front', async () => {
    const reads = stubRequests(NEW_MEMBERS, { pending: [], handled: [] });
    await renderFamilyPage(PAGE);

    backToFront();

    expect(await screen.findByText('没有新的申请')).toBeTruthy();
    expect(reads.reads).toBe(2);
  });

  it('sends a member who is not the admin to the family page', async () => {
    const { router } = await renderFamilyPage(PAGE, {
      me: ZIHANG,
      families: [LINYUE_FAMILY_FOR_ZIHANG],
    });

    expect(router.url).toBe(`/families/${LINYUE_FAMILY_ID}`);
    expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
  });

  it('says the family is not there once the parent has been taken out of it', async () => {
    await renderNewMembers();
    stubError(`get ${REQUESTS_PATH}`, 404, 'family_not_found');

    backToFront();

    expect(await screen.findByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
  });
});
