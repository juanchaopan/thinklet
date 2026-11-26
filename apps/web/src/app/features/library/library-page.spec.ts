import { screen, within } from '@testing-library/angular';
import type { MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { page, userEvent } from 'vitest/browser';
import { expectNoAxeViolations, heardText, seenText } from '../../../testing/accessibility';
import {
  OPEN,
  addAleWithKeyboard,
  anyToast,
  cancel,
  changeReaders,
  childRow,
  confirmWithKeyboard,
  expectNobodyNew,
  failNext,
  openReaders,
  pageAtTop,
  renderAsLinyue,
  retryPageThatFailed,
  settled,
  spyOn,
  tickAleAndCancel,
  ticks,
} from '../../../testing/books';
import { ALE, ALE_ID, DOUDOU, XIAOMI_ID } from '../../../testing/children';
import { useFixedClock } from '../../../testing/clock';
import { holdOverlaysAt, noDialog } from '../../../testing/families';
import { dialogGone, expectToast } from '../../../testing/family-page';
import { gradeHolder } from '../../../testing/grades';
import { holdNextGet } from '../../../testing/held-answers';
import {
  BOOKS_PATH,
  LINYUE_AS_DRAWN,
  bookPath,
  stubLibrary,
  type FakeLibrary,
} from '../../../testing/library';
import { closeMenu } from '../../../testing/menus';
import { worker } from '../../../testing/network';
import { emulateTouch, moveMouseOffPage, nextFrames } from '../../../testing/pointer';
import { LINYUE_FAMILY_ID, errorBody } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { frameName } from '../../../testing/toasts';
import { VIEWPORTS, type ViewportName } from '../../../testing/viewports';

/**
 * The sizes in the order the full-page states are captured: the desktop
 * first, so the touch versions, which load the next batch once the whole
 * page is on the screen, come after it.
 */
const DESKTOP_FIRST: readonly ViewportName[] = ['desktop', 'phone', 'tablet'];

/** The address of 林悦的家's filter options in the api. */
const FILTERS_PATH = `/api/families/${LINYUE_FAMILY_ID}/book-filters`;

/** The titles of the first batch of the whole library, newest first. */
const FIRST_BATCH = [
  '花园里的小儿歌',
  '胡萝卜数数大冒险',
  'Hello，动物朋友',
  '月亮为什么会变脸',
  '让小机器人走出迷宫',
  '四季里的古诗',
  '形状捉迷藏',
  '分披萨学分数',
  'My School Day 我的一天',
  '拼音小火车',
  '一颗种子的旅行',
  '一次函数的故事',
];

/** The first four titles of the whole library's math books, newest first. */
const FIRST_MATH_BOOKS = ['胡萝卜数数大冒险', '形状捉迷藏', '分披萨学分数', '一次函数的故事'];

/** Opens the library at the address as 林悦, with the counts the design draws. */
function renderLibrary(url = '/', me: MeResponse = LINYUE_AS_DRAWN) {
  return renderAsLinyue(url, me);
}

/** The titles of the cards shown, in their order. */
function titles(): string[] {
  return screen
    .queryAllByRole('article')
    .map((card) => within(card).getByRole('heading', { level: 3 }).textContent?.trim() ?? '');
}

/** The card of the book with the title. */
function card(title: string): HTMLElement {
  const article = screen.getByRole('link', { name: title }).closest('article');
  if (!(article instanceof HTMLElement)) {
    throw new Error(`No card for ${title}`);
  }
  return article;
}

/** The line of the book's card that gives its grades and subject. */
function gradeLine(title: string): HTMLElement {
  return gradeHolder(card(title));
}

/** The button of a filter, by what it says now. */
function filter(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

/** Opens a filter's options and returns them. */
async function openFilter(name: RegExp, label: string): Promise<HTMLElement> {
  await userEvent.click(filter(name));
  return screen.findByRole('dialog', { name: label });
}

/** What the tiles of a filter's options say, in their order. */
function optionNames(options: HTMLElement): Array<string | undefined> {
  return within(options)
    .getAllByRole('checkbox')
    .map((tile) => tile.textContent?.trim());
}

/** Closes the filter options on screen, as Escape does, and waits until they have gone. */
async function closeFilter(): Promise<void> {
  const options = screen.queryByRole('dialog');
  if (!options) {
    return;
  }
  options.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await noDialog();
}

/** Opens the options of a filter afresh at the current size, held fully open. */
function showFilter(name: RegExp, label: string): () => Promise<void> {
  return async () => {
    await closeFilter();
    await openFilter(name, label);
    await holdOverlaysAt(OPEN);
  };
}

/** The name screen readers give the avatars of a book's card, which open 谁能读. */
function readersButton(title: string): string {
  return `管理谁能读《${title}》`;
}

/** Opens 谁能读 from the card of the book with the title. */
function openCardReaders(title: string): Promise<HTMLElement> {
  return openReaders(readersButton(title), title);
}

/** Changes who reads the book from its card, pressing the rows of the children and 确定. */
function changeCardReaders(title: string, nicknames: readonly string[]): Promise<HTMLElement> {
  return changeReaders(readersButton(title), title, nicknames);
}

/** Opens the actions of the book's card afresh, as the current input device does it. */
async function openActions(title: string): Promise<HTMLElement> {
  await closeMenu();
  await userEvent.click(within(card(title)).getByRole('button', { name: '更多操作' }));
  return screen.findByRole('menu', { name: `《${title}》的操作` });
}

/** Chooses 从我家的书里移除 on the book's card and returns the question it asks. */
async function askToRemove(title: string): Promise<HTMLElement> {
  const menu = await openActions(title);
  await userEvent.click(within(menu).getByRole('menuitem', { name: '从我家的书里移除' }));
  return screen.findByRole('dialog', { name: `从我家的书里移除《${title}》？` });
}

/** Removes the book from its card, once asked. */
async function removeBook(title: string): Promise<void> {
  const dialog = await askToRemove(title);
  await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));
}

/** Holds back the next batch, which the fake then answers as the api does. */
function holdNextBatch(fake: FakeLibrary) {
  return holdNextGet(BOOKS_PATH, (request) => fake.list(new URL(request.url).searchParams));
}

/** The api's answer for a child who is not the family's. */
function childNotFound(): Response {
  return HttpResponse.json(errorBody('child_not_found'), { status: 404 });
}

/** Scrolls to the bottom of the page, as a finger does. */
function scrollToEnd(): void {
  window.scrollTo(0, document.documentElement.scrollHeight);
}

/** Moves a finger on the page, as a swipe at the bottom does when the page cannot scroll further. */
function swipe(): void {
  document.body.dispatchEvent(new Event('touchmove', { bubbles: true }));
}

/**
 * Opens the library on a phone's touch screen and scrolls to the end of the
 * list, where the next batch fails and says so.
 */
async function failBatchAtEndOnTouch(): Promise<void> {
  await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
  await emulateTouch(true);
  await renderLibrary();
  failNext('get', BOOKS_PATH, 500);

  scrollToEnd();
  await expectToast('出了点问题，请稍后再试');
  expect(titles()).toHaveLength(12);
}

describe('LibraryPage', () => {
  let fake: FakeLibrary;

  beforeEach(() => {
    fake = stubLibrary();
  });

  describe('the first batch', () => {
    it('welcomes the parent and shows 12 books, newest first, with what the family has done with them', async () => {
      const { router } = await renderLibrary();

      expect(document.title).toBe('好奇星球');
      expect(screen.getByRole('heading', { level: 1, name: '欢迎回来，林悦' })).toBeTruthy();
      expect(screen.getByText('挑几本书，分派给孩子吧。')).toBeTruthy();
      expect(screen.getByRole('link', { name: '书库' }).getAttribute('aria-current')).toBe('page');
      expect(titles()).toEqual(FIRST_BATCH);
      const garden = within(card('花园里的小儿歌'));
      expect(seenText(gradeLine('花园里的小儿歌'))).toBe('学前～一年级 · 语文');
      expect(garden.getByRole('button', { name: '获取' })).toBeTruthy();
      expect(garden.queryByRole('button', { name: '更多操作' })).toBeNull();
      expect(garden.getByRole('link').getAttribute('href')).toBe('/books/garden-rhymes');
      const carrots = within(card('胡萝卜数数大冒险'));
      expect(seenText(gradeLine('胡萝卜数数大冒险'))).toBe('一年级 · 数学');
      expect(carrots.getByText('已获取')).toBeTruthy();
      expect(carrots.getByText('小米、豆豆可以读')).toBeTruthy();
      expect(carrots.queryByRole('button', { name: '更多操作' })).toBeNull();
      expect(within(card('形状捉迷藏')).getByText('+2')).toBeTruthy();
      const moon = within(card('月亮为什么会变脸'));
      expect(moon.getByText('还没有孩子在读')).toBeTruthy();
      expect(moon.getByRole('button', { name: '更多操作' })).toBeTruthy();
      const cover = card('胡萝卜数数大冒险').querySelector('img');
      expect(cover?.getAttribute('src')).toBe('/api/books/carrot-counting/cover?v=ffcf5c');
      expect(card('Hello，动物朋友').querySelector('img')).toBeNull();
      expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy();
      expect(router.url).toBe('/');
      await expectNoAxeViolations();

      const next = holdNextBatch(fake);
      await expectScreenshotsAtEverySize('library', undefined, { sizes: DESKTOP_FIRST });
      await next.reached;
      await next.release();
    });

    it('writes the grades of a book for several grades as a range, which screen readers hear with 到', async () => {
      await renderLibrary();

      expect(seenText(gradeLine('让小机器人走出迷宫'))).toBe('四年级～初二 · 编程');
      expect(heardText(gradeLine('让小机器人走出迷宫'))).toBe('四年级到初二 · 编程');
      expect(heardText(gradeLine('花园里的小儿歌'))).toBe('学前到一年级 · 语文');
      expect(heardText(gradeLine('胡萝卜数数大冒险'))).toBe('一年级 · 数学');
    });

    it.each([0, 120, 300, 620])('rises into place, at %i ms', async (time) => {
      await renderLibrary();

      const next = holdNextBatch(fake);
      await expectScreenshotsAtEverySize(`library-entering-${frameName(time)}`, undefined, {
        heldAt: time,
        sizes: DESKTOP_FIRST,
      });
      await next.reached;
      await next.release();
    });

    it('shows the default cover when a cover cannot be read', async () => {
      fake.coversMissing = true;
      await renderLibrary();

      await vi.waitFor(() => {
        expect(card('胡萝卜数数大冒险').querySelector('img')).toBeNull();
      });
    });

    it('says the page did not open when the books cannot be read, and opens on 重试', async () => {
      failNext('get', BOOKS_PATH, 500);
      await renderLibrary();

      await retryPageThatFailed();

      expect(titles()).toHaveLength(12);
    });
  });

  describe('loading more', () => {
    it('brings the next 12 with 加载更多, and says when every book is shown', async () => {
      await renderLibrary();

      await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
      await settled();
      expect(titles()).toHaveLength(24);
      expect(titles()[12]).toBe('ABC 唱唱书');

      await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
      await settled();
      expect(titles()).toHaveLength(30);
      expect(titles()).not.toContain('小兔数萝卜');
      expect(screen.getByText('全部的书都在这里了')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
      await moveMouseOffPage();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-end');
    });

    it('loads the next batch on a touch screen as the end of the list scrolls into view', async () => {
      await page.viewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
      await emulateTouch(true);
      await renderLibrary();

      expect(titles()).toHaveLength(12);
      expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();

      scrollToEnd();
      await vi.waitFor(() => {
        expect(titles()).toHaveLength(24);
      });
      await settled();
      scrollToEnd();
      await vi.waitFor(() => {
        expect(titles()).toHaveLength(30);
      });
      expect(screen.getByText('全部的书都在这里了')).toBeTruthy();
    });

    it('keeps the books and 加载更多 when a batch fails, and loads it when asked again', async () => {
      await renderLibrary();
      failNext('get', BOOKS_PATH, 500);
      await userEvent.click(screen.getByRole('button', { name: '加载更多' }));

      await expectToast('出了点问题，请稍后再试');
      expect(titles()).toHaveLength(12);
      await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
      await settled();
      expect(titles()).toHaveLength(24);
    });

    it('tries again on a touch screen when the end scrolls into view again after a failure', async () => {
      await failBatchAtEndOnTouch();

      window.scrollTo(0, 0);
      await nextFrames();
      await nextFrames();
      scrollToEnd();
      await vi.waitFor(() => {
        expect(titles()).toHaveLength(24);
      });
    });

    it('tries again on a touch screen with the next swipe after a failure, while the end stays in view', async () => {
      await failBatchAtEndOnTouch();
      await settled();

      const retry = holdNextBatch(fake);
      let retried = false;
      void retry.reached.then(() => {
        retried = true;
      });
      await nextFrames();
      await nextFrames();
      expect(retried).toBe(false);

      swipe();
      await retry.reached;
      await retry.release();
      await vi.waitFor(() => {
        expect(titles()).toHaveLength(24);
      });
    });
  });

  describe('the filters', () => {
    it('filters by several grades at once, keeps them in the address and says what they let through', async () => {
      const { router } = await renderLibrary();

      const grades = await openFilter(/^年级：全部/, '年级');
      expect(within(grades).getAllByRole('checkbox')).toHaveLength(13);
      await userEvent.click(within(grades).getByRole('checkbox', { name: '一年级' }));
      await settled();

      expect(router.url).toBe('/?grade=grade-1');
      expect(filter(/^年级：一年级/)).toBeTruthy();
      expect(
        within(grades).getByRole('checkbox', { name: '一年级' }).getAttribute('aria-checked'),
      ).toBe('true');
      expect(titles()).toEqual([
        '花园里的小儿歌',
        '胡萝卜数数大冒险',
        '拼音小火车',
        '箭头卡片编程',
      ]);

      await userEvent.click(within(grades).getByRole('checkbox', { name: '二年级' }));
      await settled();
      expect(filter(/^年级：一年级、二年级/)).toBeTruthy();
      expect(router.url).toBe('/?grade=grade-1&grade=grade-2');
      await userEvent.click(within(grades).getByRole('checkbox', { name: '学前' }));
      await settled();
      expect(filter(/^年级：3 个/)).toBeTruthy();

      await userEvent.click(within(grades).getByRole('button', { name: '清除' }));
      await settled();
      expect(router.url).toBe('/');
      expect(filter(/^年级：全部/)).toBeTruthy();
      expect(titles()).toHaveLength(12);

      await userEvent.click(within(grades).getByRole('button', { name: '完成' }));
      await noDialog();
      expect(document.activeElement).toBe(filter(/^年级：全部/));
    });

    it('lets through every book whose range holds a grade chosen', async () => {
      await renderLibrary('/?grade=grade-5');

      expect(titles()).toEqual([
        '让小机器人走出迷宫',
        '四季里的古诗',
        '家里的电从哪里来',
        '用 Scratch 做小游戏',
      ]);
    });

    it('shows the grades chosen in the address, three to a row', async () => {
      await renderLibrary('/?grade=grade-1&grade=grade-2');

      expect(filter(/^年级：一年级、二年级/)).toBeTruthy();
      expect(titles()).toEqual([
        '花园里的小儿歌',
        '胡萝卜数数大冒险',
        'Hello，动物朋友',
        '拼音小火车',
        '一颗种子的旅行',
        '箭头卡片编程',
        '认识钟表和时间',
        '成语小故事',
      ]);
      await openFilter(/^年级：一年级、二年级/, '年级');
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-filter-grade', undefined, {
        prepare: showFilter(/^年级：一年级、二年级/, '年级'),
      });
    });

    it('takes a grade and a subject that do not exist in the address as no filter, as the api does', async () => {
      await renderLibrary('/?grade=no-such-grade&subject=no-such-subject');

      expect(filter(/^年级：全部/)).toBeTruthy();
      expect(filter(/^学科：全部/)).toBeTruthy();
      expect(titles()).toEqual(FIRST_BATCH);
      const subjects = await openFilter(/^学科：全部/, '学科');
      expect(optionNames(subjects)).toEqual(['语文', '数学', '英语', '科学', '编程']);
    });

    it('keeps the subject chosen beside a grade that does not exist', async () => {
      await renderLibrary('/?grade=no-such-grade&subject=math');

      expect(filter(/^年级：全部/)).toBeTruthy();
      expect(filter(/^学科：数学/)).toBeTruthy();
      expect(titles().slice(0, 4)).toEqual(FIRST_MATH_BOOKS);
    });

    it('offers only the subjects with books under the other filters', async () => {
      await renderLibrary('/?grade=grade-7');

      const subjects = await openFilter(/^学科：全部/, '学科');

      expect(optionNames(subjects)).toEqual(['数学', '英语', '科学', '编程']);
    });

    it('filters by subject, ticking the subject chosen', async () => {
      const { router } = await renderLibrary();

      const subjects = await openFilter(/^学科：全部/, '学科');
      await userEvent.click(within(subjects).getByRole('checkbox', { name: '数学' }));
      await settled();

      expect(router.url).toBe('/?subject=math');
      expect(filter(/^学科：数学/)).toBeTruthy();
      expect(titles().slice(0, 4)).toEqual(FIRST_MATH_BOOKS);
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-filter-subject', undefined, {
        prepare: showFilter(/^学科：数学/, '学科'),
      });
    });

    it('lists the scopes with the children, the chosen one ticked', async () => {
      await renderLibrary();

      const scopes = await openFilter(/^范围：书库/, '范围');

      expect(within(scopes).getAllByRole('radio')).toHaveLength(5);
      expect(within(scopes).getByRole('radio', { name: '书库' }).getAttribute('aria-checked')).toBe(
        'true',
      );
      expect(
        within(scopes).getByRole('radio', { name: '我家的书' }).getAttribute('aria-checked'),
      ).toBe('false');
      expect(ticks(scopes, 'radio')).toEqual(['false', 'false', 'false']);
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-scope', undefined, {
        prepare: showFilter(/^范围：书库/, '范围'),
      });
    });

    it('shows the family’s books, inactive ones included, with 已下架', async () => {
      const { router } = await renderLibrary();

      const scopes = await openFilter(/^范围：书库/, '范围');
      await userEvent.click(within(scopes).getByRole('radio', { name: '我家的书' }));
      await noDialog();
      await settled();

      expect(router.url).toBe('/?scope=family');
      expect(filter(/^范围：我家的书/)).toBeTruthy();
      expect(titles()).toEqual([
        '胡萝卜数数大冒险',
        '月亮为什么会变脸',
        '让小机器人走出迷宫',
        '四季里的古诗',
        '形状捉迷藏',
        '一颗种子的旅行',
        '小兔数萝卜',
        '一起来写日记',
        '细胞：看不见的小世界',
      ]);
      expect(within(card('小兔数萝卜')).getByText('已下架')).toBeTruthy();
      expect(screen.getByText('全部的书都在这里了')).toBeTruthy();
      await moveMouseOffPage();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-my-family');
    });

    it('shows the books a child reads', async () => {
      const { router } = await renderLibrary();

      const scopes = await openFilter(/^范围：书库/, '范围');
      await userEvent.click(within(scopes).getByRole('radio', { name: '小米' }));
      await settled();

      expect(router.url).toBe(`/?scope=child&child=${XIAOMI_ID}`);
      expect(filter(/^范围：小米/)).toBeTruthy();
      expect(titles()).toEqual([
        '胡萝卜数数大冒险',
        '四季里的古诗',
        '形状捉迷藏',
        '小兔数萝卜',
        '一起来写日记',
      ]);
    });

    it('takes a child who is not the family’s in the address as the whole library', async () => {
      await renderLibrary('/?scope=child&child=f0f0f0f0-0000-4000-8000-000000000000');

      expect(filter(/^范围：书库/)).toBeTruthy();
      expect(titles()).toHaveLength(12);
    });

    it('goes back to the library when the child of the scope is deleted meanwhile', async () => {
      await renderLibrary(`/?scope=child&child=${XIAOMI_ID}`);
      fake.children = [DOUDOU, ALE];

      const grades = await openFilter(/^年级：全部/, '年级');
      await userEvent.click(within(grades).getByRole('checkbox', { name: '学前' }));
      await settled();

      expect(filter(/^范围：书库/)).toBeTruthy();
      expect(titles()).toEqual(['花园里的小儿歌', '形状捉迷藏', 'ABC 唱唱书', '颜色变变变']);
    });

    it('goes back to the library without a word when the child of the scope is deleted as the page opens', async () => {
      worker.use(
        http.get(
          FILTERS_PATH,
          () => {
            fake.children = [DOUDOU, ALE];
            return childNotFound();
          },
          { once: true },
        ),
      );

      await renderLibrary(`/?scope=child&child=${XIAOMI_ID}`);

      await vi.waitFor(() => {
        expect(filter(/^范围：书库/)).toBeTruthy();
      });
      expect(titles()).toHaveLength(12);
      expect(screen.queryByRole('heading', { name: '页面没能打开' })).toBeNull();
      expect(anyToast()).toBe(false);
    });

    it('reads the children again only once when the child of the scope keeps being refused', async () => {
      let asked = 0;
      worker.use(
        http.get(FILTERS_PATH, () => {
          asked += 1;
          return childNotFound();
        }),
      );

      await renderLibrary(`/?scope=child&child=${XIAOMI_ID}`);

      await vi.waitFor(() => {
        expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
      });
      await settled();
      expect(asked).toBe(2);
    });

    it('says when no book fits, and 清除筛选 takes every filter back', async () => {
      const { router } = await renderLibrary('/?grade=grade-10');

      expect(screen.getByRole('heading', { level: 2, name: '没有符合条件的书' })).toBeTruthy();
      expect(filter(/^年级：高一/)).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-empty');

      await userEvent.click(screen.getByRole('button', { name: '清除筛选' }));
      await settled();

      expect(router.url).toBe('/');
      expect(titles()).toHaveLength(12);
    });

    it('chooses grades with the keyboard alone', async () => {
      const { router } = await renderLibrary();

      filter(/^年级：全部/).focus();
      await userEvent.keyboard('{Enter}');
      const grades = await screen.findByRole('dialog', { name: '年级' });
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(within(grades).getByRole('checkbox', { name: '学前' }));
      });
      await userEvent.tab();
      await userEvent.keyboard(' ');
      await settled();

      expect(router.url).toBe('/?grade=grade-1');
      await userEvent.keyboard('{Escape}');
      await noDialog();
      expect(document.activeElement).toBe(filter(/^年级：一年级/));
    });
  });

  describe('acquiring', () => {
    it('takes a book into the family’s books without a word', async () => {
      await renderLibrary();
      const calls = spyOn('put', bookPath('garden-rhymes', '/acquisition'));

      await userEvent.click(within(card('花园里的小儿歌')).getByRole('button', { name: '获取' }));
      await settled();

      expect(calls).toHaveLength(1);
      const garden = within(card('花园里的小儿歌'));
      expect(garden.getByText('已获取')).toBeTruthy();
      expect(garden.getByRole('button', { name: '管理谁能读《花园里的小儿歌》' })).toBeTruthy();
      expect(garden.getByRole('button', { name: '更多操作' })).toBeTruthy();
      expect(anyToast()).toBe(false);
    });

    it('acquires with the keyboard alone', async () => {
      await renderLibrary();

      within(card('花园里的小儿歌')).getByRole('link').focus();
      await userEvent.tab();
      expect(document.activeElement?.textContent?.trim()).toBe('获取');
      await userEvent.keyboard('{Enter}');
      await settled();

      expect(within(card('花园里的小儿歌')).getByText('已获取')).toBeTruthy();
    });

    it('says 这本书已下架 for a book taken off the library meanwhile, and takes it away', async () => {
      await renderLibrary();
      failNext('put', bookPath('garden-rhymes', '/acquisition'), 409, 'book_inactive');
      failNext('get', bookPath('garden-rhymes'), 404, 'book_not_found');

      await userEvent.click(within(card('花园里的小儿歌')).getByRole('button', { name: '获取' }));

      await expectToast('这本书已下架');
      await vi.waitFor(() => {
        expect(titles()).not.toContain('花园里的小儿歌');
      });
    });

    it('reads the library again without a word for a book that is gone', async () => {
      await renderLibrary();
      failNext('put', bookPath('garden-rhymes', '/acquisition'), 404, 'book_not_found');
      fake.owned.set('hello-animals', []);

      await userEvent.click(within(card('花园里的小儿歌')).getByRole('button', { name: '获取' }));

      await vi.waitFor(() => {
        expect(within(card('Hello，动物朋友')).getByText('已获取')).toBeTruthy();
      });
      expect(titles()).toHaveLength(12);
      expect(anyToast()).toBe(false);
    });

    it('says 出了点问题 and keeps 获取 when the server fails', async () => {
      await renderLibrary();
      failNext('put', bookPath('garden-rhymes', '/acquisition'), 500);

      await userEvent.click(within(card('花园里的小儿歌')).getByRole('button', { name: '获取' }));

      await expectToast('出了点问题，请稍后再试');
      expect(within(card('花园里的小儿歌')).getByRole('button', { name: '获取' })).toBeTruthy();
    });
  });

  describe('谁能读', () => {
    it('ticks the children who read the book, and offers 确定 only once the choice changes', async () => {
      await renderLibrary();

      const dialog = await openCardReaders('胡萝卜数数大冒险');

      expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3);
      expect(ticks(dialog, 'checkbox')).toEqual(['true', 'true', 'false']);
      expect(within(dialog).queryByRole('button', { name: '确定' })).toBeNull();
      expect(within(dialog).getByRole('button', { name: '取消' })).toBeTruthy();
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-assign', undefined, { prepare: pageAtTop });

      await userEvent.click(childRow(dialog, '阿乐'));
      expect(ticks(dialog, 'checkbox')).toEqual(['true', 'true', 'true']);
      expect(within(dialog).getByRole('button', { name: '确定' })).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-assign-changed', undefined, {
        prepare: pageAtTop,
      });

      await userEvent.click(childRow(dialog, '阿乐'));
      expect(within(dialog).queryByRole('button', { name: '确定' })).toBeNull();
    });

    it('assigns the book to the children added, without a word', async () => {
      await renderLibrary();
      const calls = spyOn('put', bookPath('carrot-counting', '/readers'));

      await changeCardReaders('胡萝卜数数大冒险', ['阿乐']);
      await dialogGone('谁能读《胡萝卜数数大冒险》');

      expect(calls).toEqual([{ childIds: [XIAOMI_ID, DOUDOU.id, ALE_ID] }]);
      expect(within(card('胡萝卜数数大冒险')).getByText('小米、豆豆、阿乐可以读')).toBeTruthy();
      expect(anyToast()).toBe(false);
    });

    it('takes the book from the children unticked, leaving the dashed plus and 更多操作', async () => {
      await renderLibrary();

      await changeCardReaders('胡萝卜数数大冒险', ['小米', '豆豆']);
      await dialogGone('谁能读《胡萝卜数数大冒险》');

      expect(fake.owned.get('carrot-counting')).toEqual([]);
      const carrots = within(card('胡萝卜数数大冒险'));
      expect(carrots.getByText('还没有孩子在读')).toBeTruthy();
      expect(carrots.getByRole('button', { name: '更多操作' })).toBeTruthy();
    });

    it('changes nothing on 取消', async () => {
      await renderLibrary();
      const calls = spyOn('put', bookPath('carrot-counting', '/readers'));

      await tickAleAndCancel(readersButton('胡萝卜数数大冒险'), '胡萝卜数数大冒险');

      expect(calls).toEqual([]);
      expect(within(card('胡萝卜数数大冒险')).getByText('小米、豆豆可以读')).toBeTruthy();
    });

    it('lets an inactive book be taken from its readers but given to nobody new', async () => {
      await renderLibrary('/?scope=family');

      const dialog = await openCardReaders('小兔数萝卜');

      expectNobodyNew(dialog);
      expect(childRow(dialog, '阿乐').hasAttribute('disabled')).toBe(true);
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-assign-retired', undefined, {
        prepare: pageAtTop,
      });

      await userEvent.click(childRow(dialog, '小米'));
      await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
      await dialogGone('谁能读《小兔数萝卜》');

      expect(within(card('小兔数萝卜')).getByText('还没有孩子在读')).toBeTruthy();
    });

    it('says the family has no children yet, with nobody to choose', async () => {
      stubLibrary([]);
      await renderLibrary();

      const dialog = await openCardReaders('月亮为什么会变脸');

      expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
      expect(
        within(dialog).getByText('家里还没有孩子。在「孩子」里添加孩子后，就能选谁能读。'),
      ).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: '确定' })).toBeNull();
    });

    it('says 这个孩子已经被删除了 for a child deleted meanwhile, and reads the book again', async () => {
      await renderLibrary();
      fake.children = [DOUDOU, ALE];

      await changeCardReaders('胡萝卜数数大冒险', ['阿乐']);

      await expectToast('这个孩子已经被删除了');
      await dialogGone('谁能读《胡萝卜数数大冒险》');
      await vi.waitFor(() => {
        expect(within(card('胡萝卜数数大冒险')).getByText('豆豆可以读')).toBeTruthy();
      });
    });

    it('says the book left the family’s books when another parent removed it meanwhile', async () => {
      await renderLibrary();
      fake.owned.delete('moon-phases');

      await changeCardReaders('月亮为什么会变脸', ['小米']);

      await expectToast('这本书已经不在我家的书里了');
      await vi.waitFor(() => {
        expect(within(card('月亮为什么会变脸')).getByRole('button', { name: '获取' })).toBeTruthy();
      });
    });

    it('closes the choice and reads the library again without a word for a book that is gone', async () => {
      await renderLibrary();
      failNext('put', bookPath('carrot-counting', '/readers'), 404, 'book_not_found');
      fake.owned.set('carrot-counting', [XIAOMI_ID]);

      await changeCardReaders('胡萝卜数数大冒险', ['阿乐']);

      await dialogGone('谁能读《胡萝卜数数大冒险》');
      await vi.waitFor(() => {
        expect(within(card('胡萝卜数数大冒险')).getByText('小米可以读')).toBeTruthy();
      });
      expect(anyToast()).toBe(false);
    });

    it('keeps the choice open when the server fails', async () => {
      await renderLibrary();
      failNext('put', bookPath('carrot-counting', '/readers'), 500);

      const dialog = await changeCardReaders('胡萝卜数数大冒险', ['阿乐']);

      await expectToast('出了点问题，请稍后再试');
      expect(childRow(dialog, '阿乐').getAttribute('aria-checked')).toBe('true');
    });

    it('assigns with the keyboard alone', async () => {
      await renderLibrary();

      screen.getByRole('button', { name: '管理谁能读《胡萝卜数数大冒险》' }).focus();
      await userEvent.keyboard('{Enter}');
      const dialog = await screen.findByRole('dialog', { name: '谁能读《胡萝卜数数大冒险》' });
      await addAleWithKeyboard(dialog);
      await dialogGone('谁能读《胡萝卜数数大冒险》');

      expect(fake.owned.get('carrot-counting')).toEqual([XIAOMI_ID, DOUDOU.id, ALE_ID]);
    });
  });

  describe('removing', () => {
    it('offers 从我家的书里移除 for a book nobody reads', async () => {
      await renderLibrary();

      const menu = await openActions('月亮为什么会变脸');

      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent?.trim()),
      ).toEqual(['从我家的书里移除']);
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('library-card-menu', undefined, {
        prepare: async () => {
          await openActions('月亮为什么会变脸');
          await holdOverlaysAt(OPEN);
          await moveMouseOffPage();
          await pageAtTop();
        },
      });
    });

    it('asks first, removes the book and says so; the card goes back to 获取', async () => {
      await renderLibrary();
      const calls = spyOn('delete', bookPath('moon-phases', '/acquisition'));

      const dialog = await askToRemove('月亮为什么会变脸');
      expect(within(dialog).getByText('这本书还在书库里时，可以再获取。')).toBeTruthy();
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await expectToast('已移除《月亮为什么会变脸》');
      expect(calls).toHaveLength(1);
      await dialogGone(/从我家的书里移除/);
      const moon = within(card('月亮为什么会变脸'));
      expect(moon.getByRole('button', { name: '获取' })).toBeTruthy();
      expect(moon.queryByRole('button', { name: '更多操作' })).toBeNull();
    });

    it('removes nothing on 取消', async () => {
      await renderLibrary();
      const calls = spyOn('delete', bookPath('moon-phases', '/acquisition'));

      await cancel(await askToRemove('月亮为什么会变脸'), /从我家的书里移除/);

      expect(calls).toEqual([]);
      expect(within(card('月亮为什么会变脸')).getByText('已获取')).toBeTruthy();
    });

    it('takes an inactive book out of the family’s books once it is removed', async () => {
      fake.owned.set('bunny-counts', []);
      await renderLibrary('/?scope=family');

      await removeBook('小兔数萝卜');

      await expectToast('已移除《小兔数萝卜》');
      expect(titles()).not.toContain('小兔数萝卜');
    });

    it('refuses a book a child was given meanwhile, and shows who reads it now', async () => {
      await renderLibrary();
      fake.owned.set('moon-phases', [XIAOMI_ID]);

      await removeBook('月亮为什么会变脸');

      await expectToast('还有孩子在读这本书，先在「谁能读」里取消');
      await vi.waitFor(() => {
        expect(within(card('月亮为什么会变脸')).getByText('小米可以读')).toBeTruthy();
      });
      expect(
        within(card('月亮为什么会变脸')).queryByRole('button', { name: '更多操作' }),
      ).toBeNull();
    });

    it('removes with the keyboard alone', async () => {
      await renderLibrary();

      within(card('月亮为什么会变脸')).getByRole('button', { name: '更多操作' }).focus();
      await userEvent.keyboard('{Enter}');
      const menu = await screen.findByRole('menu', { name: '《月亮为什么会变脸》的操作' });
      await vi.waitFor(() => {
        expect(document.activeElement).toBe(within(menu).getByRole('menuitem'));
      });
      await userEvent.keyboard('{Enter}');
      const dialog = await screen.findByRole('dialog', {
        name: '从我家的书里移除《月亮为什么会变脸》？',
      });
      await confirmWithKeyboard(dialog);

      await expectToast('已移除《月亮为什么会变脸》');
      expect(fake.owned.has('moon-phases')).toBe(false);
    });
  });

  describe('around the library', () => {
    /**
     * Opens 林悦's menu from the avatar on the phone and the tablet, held
     * fully open; from 1024 px her entries stand in the sidebar instead, so
     * the menu is closed there.
     */
    async function showParentMenu(size: ViewportName): Promise<void> {
      if (size === 'desktop') {
        await closeMenu();
        return;
      }
      if (screen.queryAllByRole('menu').length === 0) {
        await userEvent.click(screen.getByRole('button', { name: /^林悦\s*的菜单/ }));
        await screen.findByRole('menu', { name: '林悦' });
        await holdOverlaysAt(OPEN);
      }
    }

    it("shows the parent's menu with the red dot over the library", async () => {
      await renderLibrary('/', { ...LINYUE_AS_DRAWN, requestResults: 1 });

      await expectScreenshotsAtEverySize('menu-user', undefined, { prepare: showParentMenu });
      expect(
        within(screen.getByRole('navigation', { name: '林悦' })).getByRole('link', {
          name: /^加入家庭\s*，有新的申请结果$/,
        }),
      ).toBeTruthy();
    });

    it('says 网络断开了 when the network goes away', async () => {
      await renderLibrary();

      // The toast's timer is set on a fake clock that never moves, so the
      // toast stays while it is captured.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      window.dispatchEvent(new Event('offline'));
      vi.useRealTimers();
      useFixedClock();

      expect(await screen.findByText('网络断开了，请稍后再试')).toBeTruthy();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('toast-offline-2500ms', undefined, { heldAt: 2500 });
    });

    it('reads the library again when the window comes back to the front', async () => {
      await renderLibrary();
      await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
      await settled();
      fake.owned.set('garden-rhymes', []);

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => {
        expect(within(card('花园里的小儿歌')).getByText('已获取')).toBeTruthy();
      });
      expect(titles()).toHaveLength(24);
    });
  });
});
