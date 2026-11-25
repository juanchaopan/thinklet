import { screen, within } from '@testing-library/angular';
import type { FamilyDetail, MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { CHILDREN_PATH, stubChildren } from '../../../testing/children';
import {
  dialogGone,
  expectToast,
  libraryShown,
  openDialog,
  recordCalls,
  renderFamilyPage,
  stubChangedWorld,
} from '../../../testing/family-page';
import { stubLibrary } from '../../../testing/library';
import { worker } from '../../../testing/network';
import {
  GRANDMA_FAMILY,
  LINYUE,
  LINYUE_FAMILY,
  LINYUE_FAMILY_FOR_ZIHANG,
  LINYUE_FAMILY_ID,
  LINYUE_ID,
  ZIHANG,
  stubError,
} from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { deletionConsequences } from './delete-family';

const FAMILY_PATH = `/api/families/${LINYUE_FAMILY_ID}`;

/** 林悦的家 with 林悦 as its only parent. */
const LINYUE_ALONE: FamilyDetail = {
  ...LINYUE_FAMILY,
  members: LINYUE_FAMILY.members.filter((member) => member.parentId === LINYUE_ID),
};

/** 林悦 once 林悦的家 is deleted: a member of 外婆家 only. */
const LINYUE_IN_GRANDMAS_FAMILY: MeResponse = {
  ...LINYUE,
  families: LINYUE.families.filter((family) => family.id !== LINYUE_FAMILY_ID),
};

/** 林悦 and 林悦的家 once another tab made someone else its admin. */
const NO_LONGER_ADMIN: { me: MeResponse; family: FamilyDetail } = {
  me: { ...LINYUE, families: [{ id: LINYUE_FAMILY_ID, name: '林悦的家', role: 'member' }] },
  family: { ...LINYUE_FAMILY, role: 'member' },
};

/** Opens the question before deleting 林悦的家. */
const askToDelete = () => openDialog('删除家庭', '删除「林悦的家」？');

/** Confirms the deletion in the question and waits for the page to settle. */
async function confirmDeletion(
  dialog: HTMLElement,
  fixture: { whenStable: () => Promise<unknown> },
): Promise<void> {
  await userEvent.click(within(dialog).getByRole('button', { name: '删除家庭' }));
  await fixture.whenStable();
}

describe('deletionConsequences', () => {
  it('names the children and the other parents, each half left out when there are none', () => {
    expect(deletionConsequences(3, 2)).toBe(
      '3 个孩子和他们的书、学习记录都会删掉，另外 2 位家长会离开这个家庭。不能恢复。',
    );
    expect(deletionConsequences(1, 0)).toBe('1 个孩子和他们的书、学习记录都会删掉。不能恢复。');
    expect(deletionConsequences(0, 1)).toBe('另外 1 位家长会离开这个家庭。不能恢复。');
    expect(deletionConsequences(0, 0)).toBe('不能恢复。');
  });
});

describe('DeleteFamily', () => {
  it("is the last of the admin's ways out of the family, after the faded 离开家庭", async () => {
    await renderFamilyPage();

    const leave = screen.getByRole<HTMLButtonElement>('button', { name: '离开家庭' });
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: '删除家庭' });

    expect(leave.disabled).toBe(true);
    expect(remove.disabled).toBe(false);
    expect(leave.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not there for a member who is not the admin', async () => {
    await renderFamilyPage(undefined, { me: ZIHANG, families: [LINYUE_FAMILY_FOR_ZIHANG] });

    expect(screen.getByRole('button', { name: '离开家庭' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '删除家庭' })).toBeNull();
  });

  it('asks first, naming the children and the other parents, and 取消 deletes nothing', async () => {
    stubChildren();
    const calls = recordCalls('delete', FAMILY_PATH, () => new HttpResponse(null, { status: 204 }));
    await renderFamilyPage();

    const dialog = await askToDelete();
    expect(dialog.textContent).toContain(
      '3 个孩子和他们的书、学习记录都会删掉，另外 2 位家长会离开这个家庭。不能恢复。',
    );
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('dialog-delete-family');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await dialogGone('删除「林悦的家」？');

    expect(calls).toEqual([]);
  });

  it('says only that it cannot be undone for a family of no children and no other parent', async () => {
    stubChildren([]);
    await renderFamilyPage(undefined, { families: [LINYUE_ALONE, GRANDMA_FAMILY] });

    const dialog = await askToDelete();

    expect(within(dialog).getByText('不能恢复。')).toBeTruthy();
  });

  it('deletes the family and goes on to the library of the next family, saying so', async () => {
    stubLibrary();
    const calls = recordCalls('delete', FAMILY_PATH, () => {
      stubChangedWorld(LINYUE_IN_GRANDMAS_FAMILY, GRANDMA_FAMILY);
      return new HttpResponse(null, { status: 204 });
    });
    const { fixture, router } = await renderFamilyPage();

    await confirmDeletion(await askToDelete(), fixture);

    expect(calls).toHaveLength(1);
    await expectToast('已删除「林悦的家」');
    await vi.waitFor(() => {
      expect(router.url).toBe('/');
    });
    expect(await screen.findByRole('button', { name: '外婆家 切换家庭' })).toBeTruthy();
    await libraryShown();
  });

  it('goes to the start page when no family is left', async () => {
    recordCalls('delete', FAMILY_PATH, () => {
      stubChangedWorld({ ...LINYUE, families: [] }, LINYUE_ALONE);
      return new HttpResponse(null, { status: 204 });
    });
    stubChildren([]);
    const { fixture, router } = await renderFamilyPage(undefined, {
      me: { ...LINYUE, families: LINYUE.families.slice(0, 1) },
      families: [LINYUE_ALONE],
    });

    await confirmDeletion(await askToDelete(), fixture);

    await expectToast('已删除「林悦的家」');
    await vi.waitFor(() => {
      expect(router.url).toBe('/start');
    });
  });

  it('says 你已不是管理员 when the admin role went elsewhere meanwhile, and the button goes', async () => {
    stubChildren();
    stubError(`delete ${FAMILY_PATH}`, 403, 'not_admin');
    const { fixture } = await renderFamilyPage();
    const dialog = await askToDelete();
    stubChangedWorld(NO_LONGER_ADMIN.me, NO_LONGER_ADMIN.family);

    await confirmDeletion(dialog, fixture);

    await expectToast('你已不是管理员');
    await dialogGone('删除「林悦的家」？');
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: '删除家庭' })).toBeNull();
    });
  });

  it('says 出了点问题 and asks nothing when the children cannot be read', async () => {
    worker.use(http.get(CHILDREN_PATH, () => HttpResponse.error()));
    await renderFamilyPage();

    await userEvent.click(screen.getByRole('button', { name: '删除家庭' }));

    await expectToast('出了点问题，请稍后再试');
    expect(screen.queryByRole('dialog', { name: '删除「林悦的家」？' })).toBeNull();
  });
});
