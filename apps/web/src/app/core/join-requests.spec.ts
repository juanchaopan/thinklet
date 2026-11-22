import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../testing/app';
import { backToFront } from '../../testing/family-page';
import { holdNextGet } from '../../testing/held-answers';
import { worker } from '../../testing/network';
import {
  EXPIRED_REQUEST,
  PENDING_REQUEST,
  stubJoinRequests,
  stubSignedIn,
} from '../../testing/sample-data';

const REQUESTS_PATH = '/api/join-requests';

/** The card of the request to the family with this name. */
function card(familyName: string): HTMLElement {
  const found = screen.getByText(familyName).closest<HTMLElement>('[appcard]');
  if (!found) {
    throw new Error(`No card for ${familyName}`);
  }
  return found;
}

describe('JoinRequests', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('keeps a withdrawn request off the list when a read that started before answers later', async () => {
    worker.use(
      http.delete(`${REQUESTS_PATH}/${PENDING_REQUEST.id}`, () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );
    stubJoinRequests([PENDING_REQUEST]);
    await renderApp('/join');
    const older = holdNextGet(REQUESTS_PATH, () => HttpResponse.json([PENDING_REQUEST]));
    backToFront();
    await older.reached;

    await userEvent.click(
      within(card(PENDING_REQUEST.familyName)).getByRole('button', { name: '撤回' }),
    );
    expect(await screen.findByText('还没有发出过申请')).toBeTruthy();
    await older.release();

    expect(screen.getByText('还没有发出过申请')).toBeTruthy();
  });

  it('keeps the requests of a newer read when an older read answers later', async () => {
    await renderApp('/join');
    stubJoinRequests([EXPIRED_REQUEST]);
    const older = holdNextGet(REQUESTS_PATH, () => HttpResponse.json([]));
    backToFront();
    await older.reached;

    backToFront();
    expect(await screen.findByText('家庭码已更换')).toBeTruthy();
    await older.release();

    expect(screen.getByText('家庭码已更换')).toBeTruthy();
  });
});
