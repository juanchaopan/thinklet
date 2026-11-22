import { screen } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../testing/app';
import { backToFront, recordCalls } from '../../testing/family-page';
import { holdNextGet } from '../../testing/held-answers';
import { worker } from '../../testing/network';
import { LINYUE, stubSignedIn } from '../../testing/sample-data';

const RENAMED = { ...LINYUE, name: '林小悦' };

/** Whether the profile and the navigation show the parent by this name, and by no other. */
async function expectNamed(name: string, other: string): Promise<void> {
  await vi.waitFor(() => {
    expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });
  expect(screen.queryAllByText(other)).toHaveLength(0);
}

describe('Session', () => {
  beforeEach(() => {
    stubSignedIn();
  });

  it('keeps a saved name when a read of the parent that started before answers later', async () => {
    const saved = recordCalls('patch', '/api/me', () => HttpResponse.json(RENAMED));
    await renderApp('/profile');
    const older = holdNextGet('/api/me', () => HttpResponse.json(LINYUE));
    backToFront();
    await older.reached;

    await userEvent.click(screen.getByRole('button', { name: '改名字' }));
    await userEvent.fill(screen.getByRole('textbox', { name: '名字' }), '林小悦');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存');
    await older.release();

    expect(saved).toEqual([{ name: '林小悦' }]);
    await expectNamed('林小悦', '林悦');
  });

  it('keeps the parent of a newer read when an older read answers later', async () => {
    await renderApp('/profile');
    worker.use(http.get('/api/me', () => HttpResponse.json(RENAMED)));
    const older = holdNextGet('/api/me', () => HttpResponse.json(LINYUE));
    backToFront();
    await older.reached;

    backToFront();
    await expectNamed('林小悦', '林悦');
    await older.release();

    await expectNamed('林小悦', '林悦');
  });
});
