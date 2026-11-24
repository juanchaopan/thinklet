import type { Locator, Page } from '@playwright/test';
import { errorResponseSchema } from '@thinklet/contracts';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  ACTIVE_BOOK_COUNT,
  ALL_SHOWN,
  BATCH_SIZE,
  BUNNY,
  CARROT,
  NEWEST_TITLE,
  OLDEST_TITLE,
  bookCard,
  bookCards,
  cardCovers,
  cardTitles,
  coverAddress,
  expectCoversLoaded,
  filterButton,
  pickFilter,
  pickScope,
  readerRow,
  readersDialog,
  readersOnCard,
  removeDialog,
  scopeButton,
} from '../support/books.ts';
import { familyWithXiaoming } from '../support/children.ts';
import { createFamily } from '../support/families.ts';
import { expect, test } from '../support/fixtures.ts';
import { newUser, signIn } from '../support/sign-in.ts';
import { PHONE_SCREEN } from '../support/viewports.ts';

/** The active sample books of 一年级 and 初二, newest first. */
const FIRST_AND_EIGHTH_GRADES = [
  CARROT.title,
  '拼音小火车',
  '一次函数的故事',
  '箭头卡片编程',
  '文言文不难读',
];

/** Of those, the books of 数学 and 编程, newest first. */
const THEIR_MATHS_AND_CODING = [CARROT.title, '一次函数的故事', '箭头卡片编程'];

/** The active sample books of 数学 and 英语, newest first: one batch and two more. */
const MATHS_AND_ENGLISH = [
  CARROT.title,
  'Hello，动物朋友',
  '形状捉迷藏',
  '分披萨学分数',
  'My School Day 我的一天',
  '一次函数的故事',
  'ABC 唱唱书',
  '乘法花园',
  '旅行英语小手册',
  '认识钟表和时间',
  'My Family 我的家人',
  '大数有多大',
  '零下的温度：认识负数',
  '英语阅读有方法',
];

/** The most key presses it may take to reach an element of the library by keyboard. */
const MOST_PRESSES = 80;

/** 林悦 signed in with a family of her own, on its library. */
async function openLibrary(page: Page): Promise<void> {
  await signIn(page, newUser('林悦'));
  await createFamily(page, '林悦的家');
  await page.goto('/');
  await expect(bookCards(page)).toHaveCount(BATCH_SIZE);
}

/** Presses Tab until the element has the focus, as someone with only a keyboard moves to it. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  for (let presses = 0; presses < MOST_PRESSES; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/**
 * With only a keyboard, opens 谁能读 from the button, ticks or unticks the
 * child with this nickname and confirms the choice.
 */
async function toggleReaderByKeyboard(
  page: Page,
  opener: Locator,
  dialog: Locator,
  nickname: string,
): Promise<void> {
  await tabTo(page, opener);
  await page.keyboard.press('Enter');
  await tabTo(page, readerRow(dialog, nickname));
  await page.keyboard.press('Space');
  await tabTo(page, dialog.getByRole('button', { name: '确定' }));
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
}

/** Whether the page's browser takes its primary pointer to be a finger. */
function isTouchScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(pointer: coarse)').matches);
}

// The library at / with the migrations' sample books and the covers the
// cover import stored, through the mock identity provider
// (.docs/design/rules.md, 书库, 筛选, 书的卡片, 加载更多, 谁能读, 移除): every
// active book in batches of 12, by 加载更多 with a mouse and by scrolling to
// the end on a touch screen; the grade and subject filters, each taking
// several values, kept in the address; and the whole of it with only a
// keyboard. A page or dialog is checked with axe once its content is shown.
test.describe('the library', () => {
  test('shows every active sample book newest first, 12 at a time with 加载更多, each with its cover', async ({
    page,
    hasTouch,
  }) => {
    test.skip(hasTouch, 'A touch screen loads the next books as the list ends');
    await openLibrary(page);

    await expect(page.getByText('欢迎回来，林悦')).toBeVisible();
    await expect(cardTitles(page).first()).toHaveText(NEWEST_TITLE);
    await expectCoversLoaded(cardCovers(page));
    await expectAccessiblePage(page);

    const more = page.getByRole('button', { name: '加载更多' });
    await more.click();
    await expect(bookCards(page)).toHaveCount(2 * BATCH_SIZE);
    await expect(page.getByText(ALL_SHOWN)).toHaveCount(0);
    await more.click();

    await expect(bookCards(page)).toHaveCount(ACTIVE_BOOK_COUNT);
    await expect(page.getByText(ALL_SHOWN)).toBeVisible();
    await expect(more).toHaveCount(0);
    await expect(cardTitles(page).last()).toHaveText(OLDEST_TITLE);
    await expect(bookCard(page, BUNNY.title)).toHaveCount(0);
    await expect(cardCovers(page)).toHaveCount(ACTIVE_BOOK_COUNT);
    await expectCoversLoaded(cardCovers(page));
  });

  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, viewport: PHONE_SCREEN });

    test('loads the next books as the end of the list is scrolled into view, until all are shown', async ({
      page,
    }) => {
      await openLibrary(page);
      test.skip(!(await isTouchScreen(page)), 'This browser does not emulate a touch screen');
      await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);

      await bookCards(page).last().scrollIntoViewIfNeeded();
      await expect(bookCards(page)).toHaveCount(2 * BATCH_SIZE);
      await bookCards(page).last().scrollIntoViewIfNeeded();

      await expect(bookCards(page)).toHaveCount(ACTIVE_BOOK_COUNT);
      await expect(page.getByText(ALL_SHOWN)).toBeVisible();
      await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
      await expect(cardTitles(page).last()).toHaveText(OLDEST_TITLE);
    });
  });

  test('filters by several grades and subjects, offers only the subjects with books, and keeps the filters in the address', async ({
    page,
  }) => {
    await openLibrary(page);

    await pickFilter(page, '年级', ['一年级', '初二']);
    await expect(filterButton(page, '年级')).toHaveText('年级：一年级、初二');
    await expect(cardTitles(page)).toHaveText(FIRST_AND_EIGHTH_GRADES);
    await expect(page.getByText(ALL_SHOWN)).toBeVisible();

    await filterButton(page, '学科').click();
    const subjects = page.getByRole('dialog', { name: '学科' });
    await expect(subjects.getByRole('checkbox')).toHaveText(['语文', '数学', '编程']);
    await expectAccessiblePage(page);
    await subjects.getByRole('checkbox', { name: '数学' }).click();
    await subjects.getByRole('checkbox', { name: '编程' }).click();
    await expect(subjects.getByRole('checkbox', { name: '数学' })).toBeChecked();
    await subjects.getByRole('button', { name: '完成' }).click();
    await expect(filterButton(page, '学科')).toHaveText('学科：数学、编程');
    await expect(cardTitles(page)).toHaveText(THEIR_MATHS_AND_CODING);

    await page.reload();
    await expect(filterButton(page, '年级')).toHaveText('年级：一年级、初二');
    await expect(filterButton(page, '学科')).toHaveText('学科：数学、编程');
    await expect(cardTitles(page)).toHaveText(THEIR_MATHS_AND_CODING);

    await pickScope(page, '我家的书');
    await expect(page.getByRole('heading', { name: '没有符合条件的书' })).toBeVisible();
    await expectAccessiblePage(page);
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(filterButton(page, '年级')).toHaveText('年级：全部');
    await expect(filterButton(page, '学科')).toHaveText('学科：全部');
    await expect(scopeButton(page)).toHaveAccessibleName('范围：书库');
    await expect(bookCards(page)).toHaveCount(BATCH_SIZE);
    await expect(cardTitles(page).first()).toHaveText(NEWEST_TITLE);
  });

  test('works with only a keyboard: filters, loads more, acquires, lets a child read, takes it back and removes', async ({
    openParentPage,
    hasTouch,
  }) => {
    test.skip(hasTouch, 'A touch screen has no keyboard to move by');
    const { admin: page } = await familyWithXiaoming(openParentPage);
    await page.goto('/');
    await expect(bookCards(page)).toHaveCount(BATCH_SIZE);

    await tabTo(page, filterButton(page, '学科'));
    await page.keyboard.press('Enter');
    const subjects = page.getByRole('dialog', { name: '学科' });
    for (const name of ['数学', '英语']) {
      await tabTo(page, subjects.getByRole('checkbox', { name, exact: true }));
      await page.keyboard.press('Space');
      await expect(subjects.getByRole('checkbox', { name, exact: true })).toBeChecked();
    }
    await page.keyboard.press('Escape');
    await expect(subjects).toHaveCount(0);
    await expect(filterButton(page, '学科')).toBeFocused();
    await expect(filterButton(page, '学科')).toHaveText('学科：数学、英语');
    await expect(cardTitles(page)).toHaveText(MATHS_AND_ENGLISH.slice(0, BATCH_SIZE));

    const card = bookCard(page, CARROT.title);
    await tabTo(page, card.getByRole('button', { name: '获取' }));
    await page.keyboard.press('Enter');
    await expect(card.getByText('已获取')).toBeVisible();

    const readers = readersOnCard(card, CARROT.title);
    const dialog = readersDialog(page, CARROT.title);
    await toggleReaderByKeyboard(page, readers, dialog, '小明');
    await expect(readers).toHaveAccessibleDescription('小明可以读');
    await toggleReaderByKeyboard(page, readers, dialog, '小明');
    await expect(readers).toHaveAccessibleDescription('还没有孩子在读');

    await tabTo(page, card.getByRole('button', { name: '更多操作' }));
    await page.keyboard.press('Enter');
    const actions = page.getByRole('menu', { name: `《${CARROT.title}》的操作` });
    await expect(actions.getByRole('menuitem', { name: '从我家的书里移除' })).toBeFocused();
    await page.keyboard.press('Enter');
    const confirm = removeDialog(page, CARROT.title);
    await tabTo(page, confirm.getByRole('button', { name: '移除' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(`已移除《${CARROT.title}》`)).toBeVisible();
    await expect(card.getByRole('button', { name: '获取' })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: '加载更多' }));
    await page.keyboard.press('Enter');
    await expect(cardTitles(page)).toHaveText(MATHS_AND_ENGLISH);
    await expect(page.getByText(ALL_SHOWN)).toBeVisible();
  });
});

// A cover as a deployed site answers it to someone not signed in, without
// changing anything, so this also runs as a smoke test on production
// (.docs/design/interfaces.md, 通用约定: 取封面图要家长或孩子登录).
test.describe('the covers on a deployed site', () => {
  test(
    'GET a book cover through the web origin without a login answers 401 unauthenticated, never the image',
    { tag: ['@smoke', '@production-safe'] },
    async ({ request }) => {
      const response = await request.get(await coverAddress(CARROT.id));

      expect(response.status()).toBe(401);
      expect(response.headers()['content-type']).toMatch(/^application\/json/);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe('unauthenticated');
    },
  );
});
