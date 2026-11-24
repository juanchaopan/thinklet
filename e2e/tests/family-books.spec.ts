import type { Page } from '@playwright/test';
import { expectAccessiblePage } from '../support/accessibility.ts';
import {
  BUNNY,
  CARROT,
  acquireBook,
  acquiredBeforeItLeft,
  bookCard,
  bookCards,
  bookPage,
  cardCovers,
  cardTitles,
  expectCoversLoaded,
  pickFilter,
  pickScope,
  readerRow,
  readersDialog,
  readersOnCard,
  removeDialog,
  setReaders,
} from '../support/books.ts';
import {
  PASSWORD,
  addChild,
  familyWithXiaoming,
  familyWithXiaomingWithPassword,
  loginWithAccount,
  type FamilyWithChild,
} from '../support/children.ts';
import { expect, test } from '../support/fixtures.ts';

/** What a parent's library and book page say of a book nobody reads. */
const NOBODY_READS = '还没有孩子在读';

/** Signs 小明 in with his account on the child login of `page`, which opens his home page. */
async function xiaomingSignsIn(page: Page, { family }: FamilyWithChild): Promise<void> {
  await page.goto('/child');
  await loginWithAccount(page, { code: family.code, account: 'xiaoming', password: PASSWORD });
  await expect(page).toHaveURL('/child/home');
}

/** 我的书 on the child's home page, with screen readers' count of the new books. */
function myBooks(page: Page, newBooks: number) {
  return page.getByRole('heading', {
    name: new RegExp(`^我的书\\s*，${String(newBooks)} 本新书$`),
  });
}

/** Checks that the child's home page has no books. */
async function expectNoBooks(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '还没有书' })).toBeVisible();
  await expect(bookCards(page)).toHaveCount(0);
}

/** Lets the children with these nicknames read the book, and no others, in its open 谁能读 dialog. */
async function toggleReaders(page: Page, title: string, nicknames: readonly string[]) {
  const dialog = readersDialog(page, title);
  for (const nickname of nicknames) {
    await readerRow(dialog, nickname).click();
  }
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog).toHaveCount(0);
}

// A family's books, through the real api, database and storage and the mock
// identity provider (.docs/design/rules.md, 书的卡片, 书本页, 谁能读, 移除,
// 孩子首页): a parent acquires a book, lets a child read it and takes it back,
// on the card and on the book page, and the child's home page follows; a book
// a child reads cannot be removed; a book that left the library stays with
// the families that have it. Each parent and each child device has a browser
// of its own; `page` is the child's device. Books are acquired and assigned
// straight through the api where a test is not about doing it; a book
// acquired before it left the library is written into the database, as the
// site does not let a family acquire a book that has left it. A page or
// dialog is checked with axe once its content is shown.
test.describe('the family’s books', () => {
  test('a parent acquires a book, lets a child read it on the book page, and takes it back on the card; the child’s home follows', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomingWithPassword(openParentPage, request);
    const { admin } = linyue;
    await admin.goto('/');
    const card = bookCard(admin, CARROT.title);
    await card.getByRole('button', { name: '获取' }).click();

    await expect(card.getByText('已获取')).toBeVisible();
    await expect(card.getByRole('button', { name: '获取' })).toHaveCount(0);
    const readers = readersOnCard(card, CARROT.title);
    await expect(readers).toHaveAccessibleDescription(NOBODY_READS);

    await card.getByRole('link', { name: CARROT.title }).click();
    await expect(admin).toHaveURL(bookPage(CARROT.id));
    await expect(admin.getByRole('heading', { level: 1, name: CARROT.title })).toBeVisible();
    await expect(admin.getByText('已获取')).toBeVisible();
    await expect(admin.getByRole('button', { name: '获取', exact: true })).toHaveCount(0);
    await expectCoversLoaded(admin.locator('app-book-object img'));
    await admin.getByRole('button', { name: '选择谁能读' }).click();
    const dialog = readersDialog(admin, CARROT.title);
    await expect(readerRow(dialog, '小明')).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: '确定' })).toHaveCount(0);
    await expectAccessiblePage(admin);
    await toggleReaders(admin, CARROT.title, ['小明']);

    await expect(admin.getByRole('button', { name: '小明可以读' })).toBeVisible();
    await expect(admin.getByRole('button', { name: '从我家的书里移除' })).toHaveCount(0);
    await expectAccessiblePage(admin);

    await xiaomingSignsIn(page, linyue);
    await expect(myBooks(page, 1)).toBeVisible();
    await expect(cardTitles(page)).toHaveText([CARROT.title]);
    await expect(bookCard(page, CARROT.title).getByText('新', { exact: true })).toBeVisible();
    await expectCoversLoaded(cardCovers(page));
    await expectAccessiblePage(page);

    await admin.getByRole('link', { name: '返回' }).click();
    await expect(admin).toHaveURL('/');
    await expect(readers).toHaveAccessibleDescription('小明可以读');
    await expect(card.getByRole('button', { name: '更多操作' })).toHaveCount(0);
    await pickScope(admin, '小明');
    await expect(cardTitles(admin)).toHaveText([CARROT.title]);
    await pickScope(admin, '我家的书');
    await expect(cardTitles(admin)).toHaveText([CARROT.title]);

    await readers.click();
    await toggleReaders(admin, CARROT.title, ['小明']);
    await expect(readers).toHaveAccessibleDescription(NOBODY_READS);
    await card.getByRole('link', { name: CARROT.title }).click();
    await expect(admin.getByRole('button', { name: '选择谁能读' })).toBeVisible();

    await page.reload();
    await expectNoBooks(page);
  });

  test('a book a child reads cannot be removed; once nobody does, it leaves the family’s books from the card or the book page', async ({
    openParentPage,
  }) => {
    const { admin, family, child } = await familyWithXiaoming(openParentPage);
    await acquireBook(admin, family.id, CARROT.id);
    await setReaders(admin, family.id, CARROT.id, [child.id]);

    await admin.goto('/');
    const card = bookCard(admin, CARROT.title);
    await expect(readersOnCard(card, CARROT.title)).toHaveAccessibleDescription('小明可以读');
    await expect(card.getByRole('button', { name: '更多操作' })).toHaveCount(0);
    await admin.goto(bookPage(CARROT.id));
    await expect(admin.getByRole('button', { name: '小明可以读' })).toBeVisible();
    await expect(admin.getByRole('button', { name: '从我家的书里移除' })).toHaveCount(0);

    await setReaders(admin, family.id, CARROT.id, []);
    await admin.goto('/');
    await card.getByRole('button', { name: '更多操作' }).click();
    await admin
      .getByRole('menu', { name: `《${CARROT.title}》的操作` })
      .getByRole('menuitem', { name: '从我家的书里移除' })
      .click();
    const confirm = removeDialog(admin, CARROT.title);
    await expect(confirm.getByText('这本书还在书库里时，可以再获取。')).toBeVisible();
    await expectAccessiblePage(admin);
    await confirm.getByRole('button', { name: '移除' }).click();

    await expect(admin.getByText(`已移除《${CARROT.title}》`)).toBeVisible();
    await expect(card.getByRole('button', { name: '获取' })).toBeVisible();
    await expect(card.getByText('已获取')).toHaveCount(0);
    await pickScope(admin, '我家的书');
    await expect(admin.getByRole('heading', { name: '没有符合条件的书' })).toBeVisible();

    await acquireBook(admin, family.id, CARROT.id);
    await admin.goto(bookPage(CARROT.id));
    await admin.getByRole('button', { name: '从我家的书里移除' }).click();
    await removeDialog(admin, CARROT.title).getByRole('button', { name: '移除' }).click();

    await expect(admin.getByRole('button', { name: '获取', exact: true })).toBeVisible();
    await expect(admin).toHaveURL(bookPage(CARROT.id));
    await expect(admin.getByText('已获取')).toHaveCount(0);
  });

  test('a book that left the library stays in 我家的书 as 已下架: nobody new may read it, but it can be taken back and removed, and its page leads to its replacement', async ({
    page,
    openParentPage,
    request,
  }) => {
    const linyue = await familyWithXiaomingWithPassword(openParentPage, request);
    const { admin, family, child } = linyue;
    await addChild(admin, family.id, '朵朵', 'duoduo');
    await acquiredBeforeItLeft(admin, family.id, BUNNY.id, [child.id]);

    await admin.goto('/');
    await pickFilter(admin, '年级', ['一年级']);
    await pickFilter(admin, '学科', ['数学']);
    await expect(cardTitles(admin)).toHaveText([CARROT.title]);
    await pickScope(admin, '小明');
    await expect(cardTitles(admin)).toHaveText([BUNNY.title]);
    await pickScope(admin, '我家的书');
    await expect(cardTitles(admin)).toHaveText([BUNNY.title]);
    const card = bookCard(admin, BUNNY.title);
    await expect(card.getByText('已下架')).toBeVisible();
    await expect(card.getByRole('button', { name: '获取' })).toHaveCount(0);
    const readers = readersOnCard(card, BUNNY.title);
    await expect(readers).toHaveAccessibleDescription('小明可以读');

    await xiaomingSignsIn(page, linyue);
    await expect(myBooks(page, 1)).toBeVisible();
    const mine = bookCard(page, BUNNY.title);
    await expect(mine.getByText('已下架')).toBeVisible();
    await expect(mine.getByText('新', { exact: true })).toBeVisible();

    await readers.click();
    const dialog = readersDialog(admin, BUNNY.title);
    await expect(readerRow(dialog, '朵朵')).toBeDisabled();
    await expect(dialog.getByText('下架的书不能再分派')).toBeVisible();
    await expectAccessiblePage(admin);
    await toggleReaders(admin, BUNNY.title, ['小明']);
    await expect(readers).toHaveAccessibleDescription(NOBODY_READS);

    await page.reload();
    await expectNoBooks(page);

    await card.getByRole('link', { name: BUNNY.title }).click();
    await expect(admin).toHaveURL(bookPage(BUNNY.id));
    await expect(admin.getByText('这本书已下架。')).toBeVisible();
    await expectAccessiblePage(admin);
    await admin.getByRole('link', { name: `《${CARROT.title}》` }).click();
    await expect(admin).toHaveURL(bookPage(CARROT.id));
    await expect(admin.getByRole('heading', { level: 1, name: CARROT.title })).toBeVisible();
    await expect(admin.getByRole('button', { name: '获取', exact: true })).toBeVisible();

    await admin.goBack();
    await expect(admin.getByRole('heading', { level: 1, name: BUNNY.title })).toBeVisible();
    await admin.getByRole('button', { name: '从我家的书里移除' }).click();
    await removeDialog(admin, BUNNY.title).getByRole('button', { name: '移除' }).click();
    await expect(admin.getByText(`已移除《${BUNNY.title}》`)).toBeVisible();
    await expect(admin.getByRole('heading', { level: 1, name: '找不到这本书' })).toBeVisible();

    await admin.getByRole('button', { name: '回到书库' }).click();
    await expect(admin.getByRole('heading', { name: '没有符合条件的书' })).toBeVisible();
  });
});
