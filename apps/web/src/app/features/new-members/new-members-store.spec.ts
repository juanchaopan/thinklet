import { screen, within } from '@testing-library/angular';
import type { FamilyJoinRequestsResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { backToFront, renderFamilyPage } from '../../../testing/family-page';
import { holdNextGet } from '../../../testing/held-answers';
import { worker } from '../../../testing/network';
import { LINYUE_FAMILY_ID, NEW_MEMBERS } from '../../../testing/sample-data';

const PAGE = `/families/${LINYUE_FAMILY_ID}/new-members`;
const REQUESTS_PATH = `/api/families/${LINYUE_FAMILY_ID}/join-requests`;

const NONE: FamilyJoinRequestsResponse = { pending: [], handled: [] };

const answer = (lists: FamilyJoinRequestsResponse) => () => HttpResponse.json(lists);

/** The card of the requests waiting for the admin. */
const waitingCard = () =>
  screen.getByRole('heading', { name: '等你处理' }).closest('section') ?? document.body;

describe('NewMembersStore', () => {
  it('keeps a decided request out of the waiting ones when a read that started before answers later', async () => {
    const [chenxiao] = NEW_MEMBERS.pending;
    if (!chenxiao) {
      throw new Error('The sample has a waiting request');
    }
    const { id, parentId, name, email } = chenxiao;
    const handled = {
      id,
      parentId,
      name,
      email,
      status: 'approved',
      closedAt: '2026-11-21T11:30:00Z',
    };
    worker.use(
      http.get(REQUESTS_PATH, answer(NEW_MEMBERS)),
      http.post(`${REQUESTS_PATH}/${id}/approve`, () => HttpResponse.json(handled)),
    );
    await renderFamilyPage(PAGE);
    const older = holdNextGet(REQUESTS_PATH, answer(NEW_MEMBERS));
    backToFront();
    await older.reached;

    const row = within(waitingCard()).getByText(name).closest('li') ?? document.body;
    await userEvent.click(within(row).getByRole('button', { name: '同意' }));
    await vi.waitFor(() => {
      expect(within(waitingCard()).queryByText(name)).toBeNull();
    });
    await older.release();

    expect(within(waitingCard()).queryByText(name)).toBeNull();
  });

  it('keeps the requests of a newer read when an older read answers later', async () => {
    worker.use(http.get(REQUESTS_PATH, answer(NEW_MEMBERS)));
    await renderFamilyPage(PAGE);
    worker.use(http.get(REQUESTS_PATH, answer(NONE)));
    const older = holdNextGet(REQUESTS_PATH, answer(NEW_MEMBERS));
    backToFront();
    await older.reached;

    backToFront();
    expect(await screen.findByText('没有新的申请')).toBeTruthy();
    await older.release();

    expect(screen.getByText('没有新的申请')).toBeTruthy();
  });
});
