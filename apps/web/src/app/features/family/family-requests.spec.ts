import { screen, within } from '@testing-library/angular';
import type {
  FamilyDetail,
  FamilyJoinRequestsResponse,
  HandledJoinRequest,
  MeResponse,
  PendingJoinRequest,
} from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { browserIn } from '../../../testing/families';
import {
  backToFront,
  expectToast,
  recordCalls,
  stubChangedWorld,
} from '../../../testing/family-page';
import { holdNext, holdNextGet, type HeldAnswer } from '../../../testing/held-answers';
import { worker } from '../../../testing/network';
import {
  CHENXIAO_ID,
  GRANDMA_FAMILY,
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  LINYUE_WITH_REQUESTS,
  WAITING_REQUESTS,
  ZIHANG,
  linyueWaitingFor,
  stubError,
  stubSignedIn,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { frameName, raiseStillToast, toastFrame } from '../../../testing/toasts';

const PAGE = `/families/${LINYUE_FAMILY_ID}`;
const FAMILY_PATH = `/api/families/${LINYUE_FAMILY_ID}`;
const REQUESTS_PATH = `${FAMILY_PATH}/join-requests`;

const NONE: FamilyJoinRequestsResponse = { pending: [] };

function sample(index: number): PendingJoinRequest {
  const request = WAITING_REQUESTS.pending[index];
  if (!request) {
    throw new Error('The sample has two waiting requests');
  }
  return request;
}

const CHENXIAO = sample(0);
const YIFAN = sample(1);

/** 林悦的家 once 陈晓 has joined it. */
const WITH_CHENXIAO: FamilyDetail = {
  ...LINYUE_FAMILY,
  members: [
    ...LINYUE_FAMILY.members,
    {
      parentId: CHENXIAO_ID,
      name: '陈晓',
      email: 'chenxiao@example.com',
      role: 'member',
      you: false,
    },
  ],
};

type Decision = 'approve' | 'reject';

/** The request as the api answers deciding it. */
function handled(request: PendingJoinRequest, decision: Decision): HandledJoinRequest {
  const { id, parentId, name, email } = request;
  return {
    id,
    parentId,
    name,
    email,
    status: decision === 'approve' ? 'approved' : 'rejected',
    closedAt: '2026-11-22T11:30:00Z',
  };
}

/**
 * The api's answer to deciding 陈晓's request. From then on the parent has
 * one request less waiting and, once approved, 陈晓 is a member.
 */
function decideChenxiao(decision: Decision): Response {
  stubChangedWorld(linyueWaitingFor(1), decision === 'approve' ? WITH_CHENXIAO : LINYUE_FAMILY);
  return HttpResponse.json(handled(CHENXIAO, decision));
}

/** Answers deciding 陈晓's request (decideChenxiao), recording the calls. */
function stubDecision(decision: Decision): unknown[] {
  return recordCalls('post', `${REQUESTS_PATH}/${CHENXIAO.id}/${decision}`, () =>
    decideChenxiao(decision),
  );
}

/** Answers the family's requests with the lists given, the last one from then on. */
function stubRequests(...lists: FamilyJoinRequestsResponse[]): { reads: number } {
  const counter = { reads: 0 };
  worker.use(
    http.get(REQUESTS_PATH, () => {
      const answer = lists[Math.min(counter.reads, lists.length - 1)] ?? WAITING_REQUESTS;
      counter.reads++;
      return HttpResponse.json(answer);
    }),
  );
  return counter;
}

/**
 * Opens `url` (林悦的家's family page unless another address is given) as
 * `me`, with the browser in the family's time zone and the family's
 * requests answered with the lists given (stubRequests). Returns the reads.
 */
async function renderRequests(
  {
    me = LINYUE_WITH_REQUESTS,
    families = [LINYUE_FAMILY, GRANDMA_FAMILY],
    url = PAGE,
  }: { me?: MeResponse; families?: readonly FamilyDetail[]; url?: string } = {},
  ...lists: FamilyJoinRequestsResponse[]
) {
  stubSignedIn(me, families);
  const counter = stubRequests(...(lists.length > 0 ? lists : [WAITING_REQUESTS]));
  const rendered = await renderApp(url, { providers: [browserIn('Asia/Shanghai')] });
  return { ...rendered, counter };
}

/** The 等你处理 card, or null when the page has none. */
function requestsCard(): HTMLElement | null {
  return screen.queryByRole('heading', { name: '等你处理' })?.closest('section') ?? null;
}

/** The row of the applicant with the name in the 等你处理 card, or null when there is none. */
function row(name: string): HTMLElement | null {
  const card = requestsCard();
  return (card && within(card).queryByText(name)?.closest('li')) ?? null;
}

/** The row of the applicant with the name, which the card must hold. */
function shownRow(name: string): HTMLElement {
  const found = row(name);
  if (!found) {
    throw new Error(`No row for ${name}`);
  }
  return found;
}

/** What the row of the applicant says, without its spaces. */
function rowText(name: string): string {
  return (shownRow(name).textContent ?? '').replace(/\s+/g, '');
}

/** The button with the name in the row of the applicant. */
function rowButton(name: string, button: '同意' | '拒绝'): HTMLButtonElement {
  return within(shownRow(name)).getByRole<HTMLButtonElement>('button', { name: button });
}

/** The card of the family's members. */
function membersCard(): HTMLElement {
  return screen.getByRole('heading', { name: '家庭成员' }).closest('section') ?? document.body;
}

/** The red count in the element, or null when it shows none. */
function badgeIn(element: Element | undefined): Element | null {
  return element?.querySelector('[appBadge]') ?? null;
}

/** The red count on 家庭管理 in the sidebar. */
const familyCount = () => badgeIn(screen.getAllByRole('link', { name: /^家庭管理/ })[0]);

/** The red count on the family switcher in the sidebar. */
const switcherCount = () => badgeIn(screen.getAllByRole('button', { name: /切换家庭/ })[0]);

/** What a red count reads. */
const countOf = (badge: Element | null) => badge?.textContent?.trim();

/** Whether a toast is on screen. */
const anyToast = () => (document.querySelector('app-toast-outlet')?.childElementCount ?? 0) > 0;

describe('FamilyRequests', () => {
  it('shows the requests waiting between the family and its members, newest first, with the day they were sent', async () => {
    await renderRequests();

    expect(document.title).toBe('家庭管理 - 好奇星球');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent?.trim()),
    ).toEqual(['等你处理', '家庭成员']);
    expect(rowText('陈晓')).toBe('陈陈晓chenxiao@example.com·11月22日申请拒绝同意');
    expect(rowText('王一凡')).toBe('王王一凡yifan.wang@example.com·11月21日申请拒绝同意');
    expect(countOf(familyCount())).toBe('2');
    expect(countOf(switcherCount())).toBe('2');
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('family-admin-requests');
  });

  it("gives each applicant their avatar's colour, and names them for the row's buttons", async () => {
    await renderRequests();
    const chenxiao = shownRow('陈晓');

    expect(chenxiao.querySelector('app-avatar')?.classList).toContain('bg-fuchsia');
    const name = chenxiao.querySelector('p[id]');
    for (const button of within(chenxiao).getAllByRole('button')) {
      expect(button.getAttribute('aria-describedby')).toBe(name?.id);
    }
  });

  it('writes — for an applicant without an email', async () => {
    await renderRequests({}, { pending: [{ ...CHENXIAO, email: null }] });

    expect(rowText('陈晓')).toContain('陈晓—·11月22日申请');
  });

  it('shows no card while no request waits', async () => {
    await renderRequests({ me: LINYUE }, NONE);

    expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
    expect(requestsCard()).toBeNull();
  });

  it('shows a member no card, and does not ask for the requests', async () => {
    const { counter } = await renderRequests({ me: ZIHANG, families: [LINYUE_FAMILY_FOR_ZIHANG] });

    expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
    expect(requestsCard()).toBeNull();
    expect(counter.reads).toBe(0);
  });

  it('approves: the row slides out, the applicant joins the members and the counts pop, without a word', async () => {
    const calls = stubDecision('approve');
    const { fixture } = await renderRequests();
    const waiting = shownRow('陈晓');

    await userEvent.click(rowButton('陈晓', '同意'));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    expect(waiting.classList).toContain('animate-slide-away');
    await vi.waitFor(() => {
      expect(row('陈晓')).toBeNull();
    });
    expect(row('王一凡')).not.toBeNull();
    expect(within(membersCard()).getByText('陈晓')).toBeTruthy();
    await vi.waitFor(() => {
      expect(countOf(familyCount())).toBe('1');
    });
    expect(familyCount()?.classList).toContain('animate-count');
    expect(countOf(switcherCount())).toBe('1');
    expect(switcherCount()?.classList).toContain('animate-count');
    expect(anyToast()).toBe(false);
  });

  it('rejects: the row slides out and the members stay as they were, without a word', async () => {
    const calls = stubDecision('reject');
    const { fixture } = await renderRequests();

    await userEvent.click(rowButton('陈晓', '拒绝'));
    await fixture.whenStable();

    expect(calls).toHaveLength(1);
    await vi.waitFor(() => {
      expect(row('陈晓')).toBeNull();
    });
    expect(within(membersCard()).queryByText('陈晓')).toBeNull();
    await vi.waitFor(() => {
      expect(countOf(familyCount())).toBe('1');
    });
    expect(anyToast()).toBe(false);
  });

  it('shows an approved applicant among the members when another request is rejected before the family is read again', async () => {
    let reread: HeldAnswer | undefined;
    recordCalls('post', `${REQUESTS_PATH}/${CHENXIAO.id}/approve`, () => {
      const answer = decideChenxiao('approve');
      reread = holdNextGet(FAMILY_PATH, () => HttpResponse.json(WITH_CHENXIAO));
      return answer;
    });
    recordCalls('post', `${REQUESTS_PATH}/${YIFAN.id}/reject`, () => {
      stubChangedWorld(linyueWaitingFor(0), WITH_CHENXIAO);
      return HttpResponse.json(handled(YIFAN, 'reject'));
    });
    await renderRequests();

    await userEvent.click(rowButton('陈晓', '同意'));
    const held = await vi.waitFor(() => {
      if (!reread) {
        throw new Error('The family is not read again yet');
      }
      return reread;
    });
    await held.reached;
    await userEvent.click(rowButton('王一凡', '拒绝'));
    await vi.waitFor(() => {
      expect(row('王一凡')).toBeNull();
    });
    await held.release();

    expect(within(membersCard()).getByText('陈晓')).toBeTruthy();
    expect(within(membersCard()).queryByText('王一凡')).toBeNull();
  });

  it('takes the card away once the last request has been decided', async () => {
    stubDecision('reject');
    const { fixture } = await renderRequests({ me: linyueWaitingFor(1) }, { pending: [CHENXIAO] });

    await userEvent.click(rowButton('陈晓', '拒绝'));
    await fixture.whenStable();

    await vi.waitFor(() => {
      expect(requestsCard()).toBeNull();
    });
    expect(membersCard()).toBeTruthy();
  });

  it('decides a request once at a time, and leaves the others open meanwhile', async () => {
    const held = holdNext('post', `${REQUESTS_PATH}/${CHENXIAO.id}/approve`, () =>
      decideChenxiao('approve'),
    );
    await renderRequests();

    await userEvent.click(rowButton('陈晓', '同意'));
    await held.reached;

    expect(rowButton('陈晓', '同意').disabled).toBe(true);
    expect(rowButton('陈晓', '拒绝').disabled).toBe(true);
    expect(rowButton('王一凡', '同意').disabled).toBe(false);
    await held.release();

    await vi.waitFor(() => {
      expect(row('陈晓')).toBeNull();
    });
  });

  it.each([
    ['request_closed', 409, '这个申请已经失效了'],
    ['not_found', 404, '这个申请已经不在了'],
  ] as const)(
    'says why when the request changed meanwhile (%s), and reads the requests again',
    async (code, status, message) => {
      stubError(`post ${REQUESTS_PATH}/${CHENXIAO.id}/approve`, status, code);
      const { fixture, counter } = await renderRequests({}, WAITING_REQUESTS, {
        pending: [YIFAN],
      });

      await userEvent.click(rowButton('陈晓', '同意'));
      await fixture.whenStable();

      await expectToast(message);
      await vi.waitFor(() => {
        expect(row('陈晓')).toBeNull();
      });
      expect(row('王一凡')).not.toBeNull();
      expect(counter.reads).toBe(2);
    },
  );

  it('says 你已不是管理员 when the admin role went elsewhere meanwhile, and the card goes', async () => {
    stubError(`post ${REQUESTS_PATH}/${CHENXIAO.id}/reject`, 403, 'not_admin');
    const { fixture } = await renderRequests();
    stubChangedWorld(
      { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
      { ...LINYUE_FAMILY, role: 'member' },
    );

    await userEvent.click(rowButton('陈晓', '拒绝'));
    await fixture.whenStable();

    await expectToast('你已不是管理员');
    await vi.waitFor(() => {
      expect(requestsCard()).toBeNull();
    });
    expect(screen.queryByRole('button', { name: '改家庭名称' })).toBeNull();
  });

  it.each([0, 125, 250, 2500, 5250, 5400])(
    'keeps the request and says so in a toast when approving fails, at %i ms',
    async (time) => {
      stubError(`post ${REQUESTS_PATH}/${CHENXIAO.id}/approve`, 500, 'internal');
      const { fixture } = await renderRequests();
      const approve = rowButton('陈晓', '同意');

      await raiseStillToast(async () => {
        await userEvent.click(approve);
        await fixture.whenStable();
      }, '出了点问题，请稍后再试');
      await userEvent.unhover(approve);

      expect(shownRow('陈晓').classList).not.toContain('animate-slide-away');
      expect(approve.disabled).toBe(false);
      await expectScreenshotsAtEverySize(
        `toast-action-error-${frameName(time)}`,
        undefined,
        toastFrame(time, 'error'),
      );
    },
  );

  it('reads the requests again when the window comes back to the front', async () => {
    const { counter } = await renderRequests({ me: LINYUE }, NONE, WAITING_REQUESTS);
    expect(requestsCard()).toBeNull();

    backToFront();

    await vi.waitFor(() => {
      expect(row('陈晓')).not.toBeNull();
    });
    expect(counter.reads).toBe(2);
  });

  it('keeps a decided request out when a read that started before answers later', async () => {
    stubDecision('approve');
    await renderRequests();
    const older = holdNextGet(REQUESTS_PATH, () => HttpResponse.json(WAITING_REQUESTS));
    backToFront();
    await older.reached;

    await userEvent.click(rowButton('陈晓', '同意'));
    await vi.waitFor(() => {
      expect(row('陈晓')).toBeNull();
    });
    await older.release();

    expect(row('陈晓')).toBeNull();
  });

  it('says the family is not there once the parent has been taken out of it', async () => {
    await renderRequests();
    stubError(`get ${REQUESTS_PATH}`, 404, 'family_not_found');

    backToFront();

    expect(await screen.findByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
  });

  describe('the new-members address', () => {
    it.each([
      ['the admin', LINYUE_WITH_REQUESTS, [LINYUE_FAMILY, GRANDMA_FAMILY]],
      ['a member', ZIHANG, [LINYUE_FAMILY_FOR_ZIHANG]],
    ] as const)('opens the family page for %s, without a word', async (_who, me, families) => {
      const { router } = await renderRequests({
        me,
        families,
        url: `${PAGE}/new-members`,
      });

      expect(router.url).toBe(PAGE);
      expect(document.title).toBe('家庭管理 - 好奇星球');
      expect(screen.getByRole('heading', { level: 1, name: '林悦的家' })).toBeTruthy();
      expect(anyToast()).toBe(false);
    });
  });
});
