import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import { bookDetailSchema, type BookDetail } from '@thinklet/contracts';
import { query } from '../../apps/api/test/support/database.ts';
import { sentFrom } from './children.ts';

// The library, the book pages and the books of a family in the end-to-end
// tests: the sample books the migrations write, the cards, filters and
// dialogs as a parent finds them, books acquired and assigned straight
// through the api where a test is not about doing it, and what the site no
// longer lets a family do, written into the database.

/** How many books the library shows at a time (rules.md, 加载更多). */
export const BATCH_SIZE = 12;

/** How many of the sample books are in the library. */
export const ACTIVE_BOOK_COUNT = 30;

/** The newest and the oldest active sample books, which open and end the library. */
export const NEWEST_TITLE = '花园里的小儿歌';
export const OLDEST_TITLE = '成语小故事';

/** An active sample book of 一年级 · 数学. */
export const CARROT = { id: 'carrot-counting', title: '胡萝卜数数大冒险' };

/** The inactive sample book of 一年级 · 数学, which `CARROT` replaces. */
export const BUNNY = { id: 'bunny-counts', title: '小兔数萝卜' };

/** What the library says under its last book. */
export const ALL_SHOWN = '全部的书都在这里了';

/** The book page of a book. */
export function bookPage(bookId: string): string {
  return `/books/${bookId}`;
}

/** The api of a family's book. */
function bookApi(familyId: string, bookId: string): string {
  return `/api/families/${familyId}/books/${bookId}`;
}

/**
 * The address of the sample book's cover as the site serves it, carrying
 * the SHA-256 of the cover in the repository's content/books/, as the cover
 * import records it.
 */
export async function coverAddress(bookId: string): Promise<string> {
  const file = new URL(`../../content/books/${bookId}/cover.png`, import.meta.url);
  const hash = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  return `/api/books/${bookId}/cover?v=${hash}`;
}

/** The book cards of the page, in the order it shows them. */
export function bookCards(page: Page): Locator {
  return page.getByRole('main').getByRole('article');
}

/** The card of the book with this title. */
export function bookCard(page: Page, title: string): Locator {
  return bookCards(page).filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

/** The titles of the cards the page shows, in order. */
export function cardTitles(page: Page): Locator {
  return bookCards(page).getByRole('heading', { level: 3 });
}

/** The cover images the page's cards show; a card with the default cover shows none. */
export function cardCovers(page: Page): Locator {
  return bookCards(page).locator('app-book-cover img');
}

/** The button of a library card that opens 谁能读, with the readers' avatars or the dashed plus. */
export function readersOnCard(card: Locator, title: string): Locator {
  return card.getByRole('button', { name: `管理谁能读《${title}》` });
}

/** The 谁能读 dialog of the book with this title. */
export function readersDialog(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: `谁能读《${title}》` });
}

/** The question asked before the book with this title leaves the family's books. */
export function removeDialog(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: `从我家的书里移除《${title}》？` });
}

/** The child's row in a 谁能读 dialog, which ticks or unticks the child. */
export function readerRow(dialog: Locator, nickname: string): Locator {
  return dialog.getByRole('checkbox', { name: nickname });
}

/** The button of the library's 年级 or 学科 filter, which says what it lets through. */
export function filterButton(page: Page, filter: '年级' | '学科'): Locator {
  return page.getByRole('button', { name: new RegExp(`^${filter}：`) });
}

/** The button of the library's scope filter, which screen readers hear as 范围：<scope>. */
export function scopeButton(page: Page): Locator {
  return page.getByRole('button', { name: /^范围：/ });
}

/** Ticks these grades or subjects in the filter's options, one after another, then 完成. */
export async function pickFilter(
  page: Page,
  filter: '年级' | '学科',
  names: readonly string[],
): Promise<void> {
  await filterButton(page, filter).click();
  const options = page.getByRole('dialog', { name: filter });
  for (const name of names) {
    await options.getByRole('checkbox', { name, exact: true }).click();
  }
  await options.getByRole('button', { name: '完成' }).click();
  await expect(options).toHaveCount(0);
}

/** Chooses the scope with this name: 书库, 我家的书 or a child's nickname. */
export async function pickScope(page: Page, name: string): Promise<void> {
  await scopeButton(page).click();
  await page.getByRole('dialog', { name: '范围' }).getByRole('radio', { name }).click();
  await expect(scopeButton(page)).toHaveAccessibleName(`范围：${name}`);
}

/** Checks that every cover the locator holds has been loaded and drawn as an image. */
export async function expectCoversLoaded(covers: Locator): Promise<void> {
  await expect
    .poll(() =>
      covers.evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
}

/** Acquires the book for the family through the api, as 获取 does. */
export async function acquireBook(page: Page, familyId: string, bookId: string): Promise<void> {
  const response = await page.request.put(`${bookApi(familyId, bookId)}/acquisition`, {
    headers: sentFrom(page),
  });
  expect(response.status()).toBe(200);
}

/** Sets who reads the family's book through the api, as 谁能读's 确定 does. */
export async function setReaders(
  page: Page,
  familyId: string,
  bookId: string,
  childIds: readonly string[],
): Promise<BookDetail> {
  const response = await page.request.put(`${bookApi(familyId, bookId)}/readers`, {
    data: { childIds },
    headers: sentFrom(page),
  });
  expect(response.status()).toBe(200);
  return bookDetailSchema.parse(await response.json());
}

/** The database of the environment `task test-e2e` started. */
function databaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('Set TEST_DATABASE_URL to the database of the site (task test-e2e sets it)');
  }
  return url;
}

/**
 * Records in the database that the family acquired the book and gave it to
 * these children, as it could while the book was in the library. The site
 * refuses both for an inactive book, so this is how a test gets a family
 * that acquired a book before it left the library.
 */
export async function acquiredBeforeItLeft(
  familyId: string,
  bookId: string,
  childIds: readonly string[],
): Promise<void> {
  const url = databaseUrl();
  await query(url, 'insert into family_books (family_id, book_id) values ($1, $2)', [
    familyId,
    bookId,
  ]);
  for (const childId of childIds) {
    await query(
      url,
      'insert into book_assignments (child_id, family_id, book_id) values ($1, $2, $3)',
      [childId, familyId, bookId],
    );
  }
}
