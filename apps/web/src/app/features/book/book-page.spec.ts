import { screen, within } from '@testing-library/angular';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, heardText, seenText } from '../../../testing/accessibility';
import {
  OPEN,
  addAleWithKeyboard,
  anyToast,
  cancel,
  changeReaders,
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
import { ALE, DOUDOU, XIAOMI } from '../../../testing/children';
import { holdOverlaysAt } from '../../../testing/families';
import { backToFront, dialogGone, expectToast } from '../../../testing/family-page';
import { gradeHolder } from '../../../testing/grades';
import { bookPath, stubLibrary, type FakeLibrary } from '../../../testing/library';
import { worker } from '../../../testing/network';
import { moveMouseOffPage } from '../../../testing/pointer';
import { GRANDMA_FAMILY_ID, LINYUE, LINYUE_FAMILY_ID } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

/** The title of the book the family has, read by 小米 and 豆豆. */
const CARROTS = '胡萝卜数数大冒险';

/** The name of 谁能读 for the book read by 小米 and 豆豆. */
const CARROTS_READERS = `谁能读《${CARROTS}》`;

/**
 * Opens the page of the book with the id as 林悦, with no requests waiting,
 * as the design draws the book page.
 */
function renderBook(bookId: string) {
  return renderAsLinyue(`/books/${bookId}`, LINYUE);
}

/** The book's title, the page's own heading. */
function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

/** The pill above the title that gives the book's grades. */
function gradePill(): HTMLElement {
  return gradeHolder(screen.getByRole('main'));
}

/** The button that opens 谁能读, by what it says. */
function readersButton(name: string | RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

/** The pictures of the page itself, leaving out the navigation's. */
function pagePictures(): HTMLImageElement[] {
  return Array.from(screen.getByRole('main').querySelectorAll('img'));
}

/** The notice of an inactive book. */
function retiredNote(): HTMLElement {
  const note = screen.getByText('这本书已下架。').closest('p');
  if (!note) {
    throw new Error('No notice of an inactive book');
  }
  return note;
}

/** Asks to remove the book shown and returns the question. */
async function askToRemove(title: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: '从我家的书里移除' }));
  return screen.findByRole('dialog', { name: `从我家的书里移除《${title}》？` });
}

/** Captures the page as it is now at every size, with nothing hovered. */
async function expectPageAtEverySize(name: string): Promise<void> {
  await moveMouseOffPage();
  await expectNoAxeViolations();
  await expectScreenshotsAtEverySize(name);
}

/**
 * Makes the next change to the book with the id find it gone, as the api
 * answers for a book that no longer exists, and the read after it too.
 */
function goneMeanwhile(bookId: string, method: 'put' | 'delete', suffix: string): void {
  failNext(method, bookPath(bookId, suffix), 404, 'book_not_found');
  failNext('get', bookPath(bookId), 404, 'book_not_found');
}

/** Waits for 找不到这本书 in place of the book, said without a toast. */
async function expectNotFoundWithoutAWord(): Promise<void> {
  expect(await screen.findByRole('heading', { level: 1, name: '找不到这本书' })).toBeTruthy();
  expect(anyToast()).toBe(false);
}

describe('BookPage', () => {
  let fake: FakeLibrary;

  beforeEach(() => {
    fake = stubLibrary();
  });

  describe('what the page shows', () => {
    it('shows a book the family does not have, with 获取', async () => {
      await renderBook('garden-rhymes');

      expect(document.title).toBe('花园里的小儿歌 - 好奇星球');
      expect(heading().textContent?.trim()).toBe('花园里的小儿歌');
      expect(seenText(gradePill())).toBe('学前～一年级');
      expect(screen.getByText('语文')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: '这本书讲什么' })).toBeTruthy();
      expect(screen.getByText(/跟着小兔老师在花园里念儿歌/)).toBeTruthy();
      expect(screen.getByRole('button', { name: '获取' })).toBeTruthy();
      expect(screen.queryByText('已获取')).toBeNull();
      expect(screen.queryByRole('button', { name: '从我家的书里移除' })).toBeNull();
      expect(screen.getByRole('link', { name: '返回' }).getAttribute('href')).toBe('/');
      expect(screen.getByRole('link', { name: '书库' }).getAttribute('aria-current')).toBe('true');
      expect(pagePictures().map((picture) => picture.getAttribute('src'))).toEqual([
        '/api/books/garden-rhymes/cover?v=f6b27a',
        '/api/books/garden-rhymes/cover?v=f6b27a',
      ]);
      await expectPageAtEverySize('book');
    });

    it('has screen readers hear the range of grades with 到', async () => {
      await renderBook('garden-rhymes');

      expect(heardText(gradePill())).toBe('学前到一年级');
    });

    it('shows a book the family has with the children who read it, and no 移除', async () => {
      await renderBook('carrot-counting');

      expect(seenText(gradePill())).toBe('一年级');
      expect(heardText(gradePill())).toBe('一年级');
      expect(screen.getByText('已获取')).toBeTruthy();
      expect(readersButton('小米、豆豆可以读').getAttribute('aria-haspopup')).toBe('dialog');
      expect(screen.queryByRole('button', { name: '获取' })).toBeNull();
      expect(screen.queryByRole('button', { name: '从我家的书里移除' })).toBeNull();
      await expectPageAtEverySize('book-acquired');
    });

    it('offers 选择谁能读 and 移除 for a book the family has and nobody reads', async () => {
      await renderBook('moon-phases');

      expect(screen.getByText('已获取')).toBeTruthy();
      expect(readersButton('选择谁能读')).toBeTruthy();
      expect(screen.getByRole('button', { name: '从我家的书里移除' })).toBeTruthy();
      await expectPageAtEverySize('book-acquired-unassigned');
    });

    it('says an inactive book has left the library, with a link to the book that replaces it', async () => {
      const { router } = await renderBook('bunny-counts');

      expect(screen.getByText('已下架')).toBeTruthy();
      expect(retiredNote().textContent?.trim()).toBe(`这本书已下架。可以换成《${CARROTS}》`);
      const replacement = within(retiredNote()).getByRole('link', { name: `《${CARROTS}》` });
      expect(replacement.getAttribute('href')).toBe('/books/carrot-counting');
      expect(readersButton('小米可以读')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '获取' })).toBeNull();
      expect(screen.queryByRole('button', { name: '从我家的书里移除' })).toBeNull();
      await expectPageAtEverySize('book-retired');

      await userEvent.click(replacement);
      await settled();

      expect(router.url).toBe('/books/carrot-counting');
      expect(heading().textContent?.trim()).toBe(CARROTS);
      expect(document.title).toBe(`${CARROTS} - 好奇星球`);
      expect(screen.queryByText('这本书已下架。')).toBeNull();
    });

    it('only says an inactive book has left the library when nothing replaces it', async () => {
      worker.use(
        http.get(bookPath('bunny-counts'), () =>
          HttpResponse.json({ ...fake.card('bunny-counts'), replacement: null }),
        ),
      );
      await renderBook('bunny-counts');

      expect(retiredNote().textContent?.trim()).toBe('这本书已下架。');
      expect(within(retiredNote()).queryByRole('link')).toBeNull();
    });

    it('offers to add a child while the family has none', async () => {
      stubLibrary([]);
      await renderBook('moon-phases');

      expect(screen.getByText('还没有孩子')).toBeTruthy();
      expect(screen.getByRole('link', { name: '去添加孩子' }).getAttribute('href')).toBe(
        `/families/${LINYUE_FAMILY_ID}/children`,
      );
      expect(screen.queryByRole('button', { name: '选择谁能读' })).toBeNull();
      expect(screen.getByRole('button', { name: '从我家的书里移除' })).toBeTruthy();
      await expectPageAtEverySize('book-no-children');
    });

    it('shows the default cover for a book without one, and in the band the tint', async () => {
      await renderBook('hello-animals');

      expect(heading().textContent?.trim()).toBe('Hello，动物朋友');
      expect(pagePictures()).toEqual([]);
    });

    it('shows the default cover when the cover cannot be read', async () => {
      fake.coversMissing = true;
      await renderBook('carrot-counting');

      await vi.waitFor(() => {
        expect(pagePictures()).toEqual([]);
      });
    });

    it('says 找不到这本书 for a book that does not exist, and 回到书库 goes to the library', async () => {
      const { router } = await renderBook('no-such-book');

      expect(screen.getByRole('heading', { level: 1, name: '找不到这本书' })).toBeTruthy();
      expect(document.title).toBe('找不到这本书 - 好奇星球');
      await expectPageAtEverySize('book-not-found');

      await userEvent.click(screen.getByRole('button', { name: '回到书库' }));
      await settled();

      expect(router.url).toBe('/');
      expect(screen.getByRole('heading', { level: 1, name: '欢迎回来，林悦' })).toBeTruthy();
    });

    it('says 找不到这本书 for an inactive book the family does not have', async () => {
      fake.owned.delete('bunny-counts');
      await renderBook('bunny-counts');

      expect(screen.getByRole('heading', { level: 1, name: '找不到这本书' })).toBeTruthy();
    });

    it('says the page did not open when the server fails, and opens on 重试', async () => {
      failNext('get', bookPath('carrot-counting'), 500);
      await renderBook('carrot-counting');

      await retryPageThatFailed();

      expect(heading().textContent?.trim()).toBe(CARROTS);
    });

    it('says 找不到这个家庭 when the parent is no longer in the family', async () => {
      failNext('get', bookPath('carrot-counting'), 404, 'family_not_found');
      await renderBook('carrot-counting');

      expect(screen.getByRole('heading', { level: 1, name: '找不到这个家庭' })).toBeTruthy();
    });
  });

  describe('around the page', () => {
    it('goes back to the library with the filters it had', async () => {
      const { router } = await renderAsLinyue('/?grade=grade-1', LINYUE);

      await userEvent.click(screen.getByRole('link', { name: CARROTS }));
      await settled();
      expect(router.url).toBe('/books/carrot-counting');
      expect(heading().textContent?.trim()).toBe(CARROTS);

      await userEvent.click(screen.getByRole('link', { name: '返回' }));
      await settled();

      expect(router.url).toBe('/?grade=grade-1');
      expect(screen.getByRole('button', { name: /^年级：一年级/ })).toBeTruthy();
    });

    it('stays on the book when the parent switches family, showing what that family has done', async () => {
      worker.use(
        http.get(`/api/families/${GRANDMA_FAMILY_ID}/books/carrot-counting`, () =>
          HttpResponse.json({
            ...fake.card('carrot-counting'),
            acquired: false,
            readers: [],
            replacement: null,
          }),
        ),
      );
      const { router } = await renderBook('carrot-counting');
      expect(readersButton('小米、豆豆可以读')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: /^林悦的家 切换家庭/ }));
      const menu = await screen.findByRole('menu', { name: '切换家庭' });
      await userEvent.click(within(menu).getByRole('menuitem', { name: /外婆家/ }));
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: '获取' })).toBeTruthy();
      });
      await settled();

      expect(router.url).toBe('/books/carrot-counting');
      expect(heading().textContent?.trim()).toBe(CARROTS);
      expect(screen.queryByText('已获取')).toBeNull();
      expect(screen.getByRole('button', { name: /^外婆家 切换家庭/ })).toBeTruthy();
    });

    it('reads the book again when the window comes back to the front', async () => {
      await renderBook('garden-rhymes');
      fake.owned.set('garden-rhymes', [XIAOMI.id]);

      backToFront();

      await vi.waitFor(() => {
        expect(readersButton('小米可以读')).toBeTruthy();
      });
    });
  });

  describe('acquiring', () => {
    it('takes the book into the family’s books without a word', async () => {
      await renderBook('garden-rhymes');
      const calls = spyOn('put', bookPath('garden-rhymes', '/acquisition'));

      await userEvent.click(screen.getByRole('button', { name: '获取' }));
      await settled();

      expect(calls).toHaveLength(1);
      expect(screen.getByText('已获取')).toBeTruthy();
      expect(readersButton('选择谁能读')).toBeTruthy();
      expect(screen.getByRole('button', { name: '从我家的书里移除' })).toBeTruthy();
      expect(anyToast()).toBe(false);
    });

    it('acquires with the keyboard alone', async () => {
      await renderBook('garden-rhymes');

      screen.getByRole('link', { name: '返回' }).focus();
      await userEvent.tab();
      expect(document.activeElement?.textContent?.trim()).toBe('获取');
      await userEvent.keyboard('{Enter}');
      await settled();

      expect(screen.getByText('已获取')).toBeTruthy();
    });

    it('says 这本书已下架 for a book taken off the library meanwhile, and reads it again', async () => {
      await renderBook('garden-rhymes');
      failNext('put', bookPath('garden-rhymes', '/acquisition'), 409, 'book_inactive');
      failNext('get', bookPath('garden-rhymes'), 404, 'book_not_found');

      await userEvent.click(screen.getByRole('button', { name: '获取' }));

      await expectToast('这本书已下架');
      expect(await screen.findByRole('heading', { level: 1, name: '找不到这本书' })).toBeTruthy();
    });

    it('says 找不到这本书 without a word for a book that is gone', async () => {
      await renderBook('garden-rhymes');
      goneMeanwhile('garden-rhymes', 'put', '/acquisition');

      await userEvent.click(screen.getByRole('button', { name: '获取' }));

      await expectNotFoundWithoutAWord();
    });

    it('says 出了点问题 and keeps 获取 when the server fails', async () => {
      await renderBook('garden-rhymes');
      failNext('put', bookPath('garden-rhymes', '/acquisition'), 500);

      await userEvent.click(screen.getByRole('button', { name: '获取' }));

      await expectToast('出了点问题，请稍后再试');
      expect(screen.getByRole('button', { name: '获取' })).toBeTruthy();
    });
  });

  describe('谁能读', () => {
    it('ticks the children who read the book', async () => {
      await renderBook('carrot-counting');

      const dialog = await openReaders('小米、豆豆可以读', CARROTS);

      expect(ticks(dialog, 'checkbox')).toEqual(['true', 'true', 'false']);
      expect(within(dialog).queryByRole('button', { name: '确定' })).toBeNull();
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-assign-book', undefined, { prepare: pageAtTop });
    });

    it('assigns the book to a child added, without a word', async () => {
      await renderBook('carrot-counting');
      const calls = spyOn('put', bookPath('carrot-counting', '/readers'));

      await changeReaders('小米、豆豆可以读', CARROTS, ['阿乐']);
      await dialogGone(CARROTS_READERS);

      expect(calls).toEqual([{ childIds: [XIAOMI.id, DOUDOU.id, ALE.id] }]);
      expect(readersButton('小米、豆豆、阿乐可以读')).toBeTruthy();
      expect(anyToast()).toBe(false);
    });

    it('takes the book from the children unticked, offering 选择谁能读 and 移除', async () => {
      await renderBook('carrot-counting');

      await changeReaders('小米、豆豆可以读', CARROTS, ['小米', '豆豆']);
      await dialogGone(CARROTS_READERS);

      expect(fake.owned.get('carrot-counting')).toEqual([]);
      expect(readersButton('选择谁能读')).toBeTruthy();
      expect(screen.getByRole('button', { name: '从我家的书里移除' })).toBeTruthy();
    });

    it('changes nothing on 取消', async () => {
      await renderBook('carrot-counting');
      const calls = spyOn('put', bookPath('carrot-counting', '/readers'));

      await tickAleAndCancel('小米、豆豆可以读', CARROTS);

      expect(calls).toEqual([]);
      expect(readersButton('小米、豆豆可以读')).toBeTruthy();
    });

    it('gives an inactive book to nobody new', async () => {
      await renderBook('bunny-counts');

      expectNobodyNew(await openReaders('小米可以读', '小兔数萝卜'));
    });

    it('says 这个孩子已经被删除了 for a child deleted meanwhile, and reads the book again', async () => {
      await renderBook('carrot-counting');
      fake.children = [DOUDOU, ALE];

      await changeReaders('小米、豆豆可以读', CARROTS, ['阿乐']);

      await expectToast('这个孩子已经被删除了');
      await dialogGone(CARROTS_READERS);
      await vi.waitFor(() => {
        expect(readersButton('豆豆可以读')).toBeTruthy();
      });
    });

    it('says the book left the family’s books when another parent removed it meanwhile', async () => {
      await renderBook('moon-phases');
      fake.owned.delete('moon-phases');

      await changeReaders('选择谁能读', '月亮为什么会变脸', ['小米']);

      await expectToast('这本书已经不在我家的书里了');
      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: '获取' })).toBeTruthy();
      });
    });

    it('closes the choice and says 找不到这本书 without a word for a book that is gone', async () => {
      await renderBook('carrot-counting');
      goneMeanwhile('carrot-counting', 'put', '/readers');

      await changeReaders('小米、豆豆可以读', CARROTS, ['阿乐']);

      await dialogGone(CARROTS_READERS);
      await expectNotFoundWithoutAWord();
    });

    it('keeps the choice open when the server fails', async () => {
      await renderBook('carrot-counting');
      failNext('put', bookPath('carrot-counting', '/readers'), 500);

      const dialog = await changeReaders('小米、豆豆可以读', CARROTS, ['阿乐']);

      await expectToast('出了点问题，请稍后再试');
      expect(ticks(dialog, 'checkbox')).toEqual(['true', 'true', 'true']);
    });

    it('assigns with the keyboard alone', async () => {
      await renderBook('carrot-counting');

      screen.getByRole('link', { name: '返回' }).focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(readersButton('小米、豆豆可以读'));
      await userEvent.keyboard('{Enter}');
      await addAleWithKeyboard(await screen.findByRole('dialog', { name: CARROTS_READERS }));
      await dialogGone(CARROTS_READERS);

      expect(readersButton('小米、豆豆、阿乐可以读')).toBeTruthy();
    });
  });

  describe('removing', () => {
    it('asks first, removes the book and says so; the page goes back to 获取', async () => {
      const { router } = await renderBook('moon-phases');
      const calls = spyOn('delete', bookPath('moon-phases', '/acquisition'));

      const dialog = await askToRemove('月亮为什么会变脸');
      expect(within(dialog).getByText('这本书还在书库里时，可以再获取。')).toBeTruthy();
      await holdOverlaysAt(OPEN);
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('dialog-remove-book', undefined, { prepare: pageAtTop });
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await expectToast('已移除《月亮为什么会变脸》');
      expect(calls).toHaveLength(1);
      await dialogGone(/从我家的书里移除/);
      expect(router.url).toBe('/books/moon-phases');
      expect(screen.getByRole('button', { name: '获取' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '从我家的书里移除' })).toBeNull();
    });

    it('removes nothing on 取消', async () => {
      await renderBook('moon-phases');
      const calls = spyOn('delete', bookPath('moon-phases', '/acquisition'));

      await cancel(await askToRemove('月亮为什么会变脸'), /从我家的书里移除/);

      expect(calls).toEqual([]);
      expect(screen.getByText('已获取')).toBeTruthy();
    });

    it('says 找不到这本书 once an inactive book is removed', async () => {
      fake.owned.set('bunny-counts', []);
      await renderBook('bunny-counts');

      const dialog = await askToRemove('小兔数萝卜');
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await expectToast('已移除《小兔数萝卜》');
      expect(screen.getByRole('heading', { level: 1, name: '找不到这本书' })).toBeTruthy();
    });

    it('refuses a book a child was given meanwhile, and shows who reads it now', async () => {
      await renderBook('moon-phases');
      fake.owned.set('moon-phases', [XIAOMI.id]);

      const dialog = await askToRemove('月亮为什么会变脸');
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await expectToast('还有孩子在读这本书，先在「谁能读」里取消');
      await vi.waitFor(() => {
        expect(readersButton('小米可以读')).toBeTruthy();
      });
      expect(screen.queryByRole('button', { name: '从我家的书里移除' })).toBeNull();
    });

    it('closes the question and says 找不到这本书 without a word for a book that is gone', async () => {
      await renderBook('moon-phases');
      goneMeanwhile('moon-phases', 'delete', '/acquisition');

      const dialog = await askToRemove('月亮为什么会变脸');
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await dialogGone(/从我家的书里移除/);
      await expectNotFoundWithoutAWord();
    });

    it('says 出了点问题 and keeps the book when the server fails', async () => {
      await renderBook('moon-phases');
      failNext('delete', bookPath('moon-phases', '/acquisition'), 500);

      const dialog = await askToRemove('月亮为什么会变脸');
      await userEvent.click(within(dialog).getByRole('button', { name: '移除' }));

      await expectToast('出了点问题，请稍后再试');
      expect(screen.getByText('已获取')).toBeTruthy();
      expect(screen.getByRole('button', { name: '从我家的书里移除' })).toBeTruthy();
    });

    it('removes with the keyboard alone', async () => {
      await renderBook('moon-phases');

      readersButton('选择谁能读').focus();
      await userEvent.tab();
      expect(document.activeElement?.textContent?.trim()).toBe('从我家的书里移除');
      await userEvent.keyboard('{Enter}');
      await confirmWithKeyboard(
        await screen.findByRole('dialog', { name: '从我家的书里移除《月亮为什么会变脸》？' }),
      );

      await expectToast('已移除《月亮为什么会变脸》');
      expect(fake.owned.has('moon-phases')).toBe(false);
    });
  });
});
