import { screen, within } from '@testing-library/angular';
import { HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../testing/app';
import { GRANDMA_CODE, noDialog } from '../../testing/families';
import { holdNextGet } from '../../testing/held-answers';
import { errorBody, stubSignedIn } from '../../testing/sample-data';

describe('JoinFamilyDialog', () => {
  it('says nothing about a lookup that fails once the dialog has closed', async () => {
    stubSignedIn();
    const { router } = await renderApp('/join');
    const lookup = holdNextGet(`/api/family-codes/${GRANDMA_CODE}`, () =>
      HttpResponse.json(errorBody('internal'), { status: 500 }),
    );

    await router.navigateByUrl(`/join/${GRANDMA_CODE}`);
    await lookup.reached;
    const dialog = await screen.findByRole('dialog', { name: '申请加入家庭' });
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await noDialog();
    await lookup.release();

    expect(router.url).toBe('/join');
    expect(screen.queryByText('出了点问题，请稍后再试')).toBeNull();
  });
});
