import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { backToFront, expectToast, renderFamilyPage } from '../../../testing/family-page';
import { holdNextGet } from '../../../testing/held-answers';
import { worker } from '../../../testing/network';
import { LINYUE_FAMILY, LINYUE_FAMILY_ID, stubError } from '../../../testing/sample-data';

const FAMILY_PATH = `/api/families/${LINYUE_FAMILY_ID}`;

const title = (name: string) => screen.queryByRole('heading', { level: 1, name });

describe('FamilyStore', () => {
  it('keeps a new name when a read of the family that started before answers later', async () => {
    worker.use(
      http.patch(FAMILY_PATH, () => HttpResponse.json({ ...LINYUE_FAMILY, name: '林家小院' })),
    );
    await renderFamilyPage();
    const older = holdNextGet(FAMILY_PATH, () => HttpResponse.json(LINYUE_FAMILY));
    backToFront();
    await older.reached;

    await userEvent.click(screen.getByRole('button', { name: '改家庭名称' }));
    await userEvent.fill(screen.getByRole('textbox', { name: '家庭名称' }), '林家小院');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await expectToast('已保存');
    await older.release();

    expect(title('林家小院')).toBeTruthy();
    expect(title('林悦的家')).toBeNull();
  });

  it('keeps the family of a newer read when an older read answers later', async () => {
    await renderFamilyPage();
    worker.use(
      http.get(FAMILY_PATH, () => HttpResponse.json({ ...LINYUE_FAMILY, code: 'H8P2RW' })),
    );
    const older = holdNextGet(FAMILY_PATH, () => HttpResponse.json(LINYUE_FAMILY));
    backToFront();
    await older.reached;

    backToFront();
    expect(await screen.findByText('H8P2RW')).toBeTruthy();
    await older.release();

    expect(screen.getByText('H8P2RW')).toBeTruthy();
    expect(screen.queryByText(LINYUE_FAMILY.code)).toBeNull();
  });

  it('says 你已经是管理员了 when the api answers that the new admin is the admin already, and reads the family again', async () => {
    stubError(`put ${FAMILY_PATH}/admin`, 409, 'already_admin');
    const { fixture } = await renderFamilyPage();
    let reads = 0;
    worker.use(
      http.get(FAMILY_PATH, () => {
        reads += 1;
        return HttpResponse.json(LINYUE_FAMILY);
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: '周子航的操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '设为管理员' }));
    const dialog = await screen.findByRole('dialog', { name: '让周子航当管理员？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    await fixture.whenStable();

    await expectToast('你已经是管理员了');
    await vi.waitFor(() => {
      expect(reads).toBeGreaterThan(0);
    });
    expect(title('林悦的家')).toBeTruthy();
  });
});
