import type { Router } from '@angular/router';
import { screen, within } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations, heardText, seenText } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { NO_BOOKS, stubChildBooks, stubChildShelf } from '../../../testing/child-books';
import {
  expectChildHome,
  findSettingsLink,
  stubChildSignedIn,
  stubRemembered,
} from '../../../testing/child-login';
import { DOUDOU_ID, XIAOMI_ID } from '../../../testing/children';
import { backToFront } from '../../../testing/family-page';
import { gradeHolder } from '../../../testing/grades';
import { stubLibrary, type FakeLibrary } from '../../../testing/library';
import { worker } from '../../../testing/network';
import { ERROR_NUMBER, stubError, stubNoChild, stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

/** 小米's books as the design draws them, latest assignment first. */
const XIAOMI_TITLES = [
  '胡萝卜数数大冒险',
  '四季里的古诗',
  '一起来写日记',
  '形状捉迷藏',
  '小兔数萝卜',
];

/** Opens the child's home page with 小米 signed in and no parent. */
async function renderChildHome() {
  stubVisitor();
  stubChildSignedIn();
  return renderApp('/child/home');
}

/** The heading of 我的书, once the child's books have come. */
function findMyBooksHeading(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 2, name: /^我的书/ });
}

/** The section of 我的书. */
function myBooks(): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: /^我的书/ }).closest('section');
  if (!section) {
    throw new Error('我的书 is not on the page');
  }
  return section;
}

/** The titles of the books in 我的书, in their order. */
function titles(): string[] {
  return within(myBooks())
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent.trim());
}

/** The card of the book with the title. */
function card(title: string): HTMLElement {
  const article = within(myBooks())
    .getByRole('heading', { level: 3, name: title })
    .closest('article');
  if (!article) {
    throw new Error(`No card for ${title}`);
  }
  return article;
}

/** The line of the book's card that gives its grades and subject. */
function gradeLine(title: string): HTMLElement {
  return gradeHolder(card(title));
}

/** The labels over the cover of the book with the title, 新 and 已下架. */
function coverTags(title: string): string[] {
  const cover = card(title).querySelector('app-book-cover');
  return Array.from(cover?.querySelectorAll('span') ?? [], (tag) => tag.textContent.trim());
}

/** Records the path of every api request from now on until the test ends. */
function recordApiPaths(): string[] {
  const paths: string[] = [];
  const started = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      paths.push(pathname);
    }
  };
  worker.events.on('request:start', started);
  onTestFinished(() => {
    worker.events.removeListener('request:start', started);
  });
  return paths;
}

/** Serves the books from a fresh fake library and returns it, for a test that changes what is assigned. */
function freshLibrary(): FakeLibrary {
  const library = stubLibrary();
  stubChildShelf(library);
  return library;
}

/** Waits until the app has gone to the child login. */
async function expectChildLogin(router: Router): Promise<void> {
  await vi.waitFor(() => {
    expect(router.url).toBe('/child');
  });
  expect(await screen.findByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
}

describe('ChildHome', () => {
  describe('我的书', () => {
    it('shows the books assigned to the child, latest first, with 新, their count and 已下架', async () => {
      await renderChildHome();

      const heading = await findMyBooksHeading();
      expect(document.title).toBe('好奇星球');
      expect(screen.getByText('你好，小米！')).toBeTruthy();
      expect(heading.querySelector('[appBadge]')?.textContent.trim()).toBe('2');
      expect(titles()).toEqual(XIAOMI_TITLES);
      expect(coverTags('胡萝卜数数大冒险')).toEqual(['新']);
      expect(coverTags('四季里的古诗')).toEqual(['新']);
      expect(coverTags('一起来写日记')).toEqual([]);
      expect(coverTags('形状捉迷藏')).toEqual([]);
      expect(coverTags('小兔数萝卜')).toEqual(['已下架']);
      expect(seenText(gradeLine('胡萝卜数数大冒险'))).toBe('一年级 · 数学');
      expect(within(card('胡萝卜数数大冒险')).getByText(/^小兔要把 20 根胡萝卜/)).toBeTruthy();
      expect(screen.queryByRole('heading', { name: '还没有书' })).toBeNull();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-home-books');
    });

    it('writes the grades of a book for several grades as a range, which screen readers hear with 到', async () => {
      await renderChildHome();
      await findMyBooksHeading();

      expect(seenText(gradeLine('四季里的古诗'))).toBe('四年级～六年级 · 语文');
      expect(heardText(gradeLine('四季里的古诗'))).toBe('四年级到六年级 · 语文');
      expect(seenText(gradeLine('一起来写日记'))).toBe('四年级 · 语文');
      expect(heardText(gradeLine('一起来写日记'))).toBe('四年级 · 语文');
    });

    it('tells screen readers the count of new books in the heading, the badge being only a mark', async () => {
      await renderChildHome();

      const heading = await findMyBooksHeading();
      expect(screen.getByRole('heading', { level: 2, name: /^我的书\s*，2 本新书$/ })).toBe(
        heading,
      );
      expect(heading.querySelector('[appBadge]')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('writes a count over 99 as 99+', async () => {
      const { books } = stubChildShelf(stubLibrary()).answer();
      stubChildBooks({ books, newCount: 120 });
      await renderChildHome();

      const heading = await findMyBooksHeading();
      expect(heading.querySelector('[appBadge]')?.textContent.trim()).toBe('99+');
      expect(screen.getByRole('heading', { level: 2, name: /^我的书\s*，99\+ 本新书$/ })).toBe(
        heading,
      );
    });

    it('shows no count while the child has opened every book', async () => {
      const shelf = stubChildShelf(stubLibrary());
      shelf.childId = DOUDOU_ID;
      await renderChildHome();

      const heading = await findMyBooksHeading();
      expect(heading.textContent.trim()).toBe('我的书');
      expect(heading.querySelector('[appBadge]')).toBeNull();
      expect(titles()).toEqual(['胡萝卜数数大冒险', '形状捉迷藏', '一颗种子的旅行']);
      expect(within(myBooks()).queryByText('新')).toBeNull();
    });

    it('leaves the cards unopenable: no link, no button, no focus and no lift under the mouse', async () => {
      await renderChildHome();
      await findMyBooksHeading();

      expect(within(myBooks()).queryAllByRole('link')).toEqual([]);
      expect(within(myBooks()).queryAllByRole('button')).toEqual([]);
      const article = card('胡萝卜数数大冒险');
      await userEvent.hover(article);
      expect(getComputedStyle(article).cursor).toBe('auto');
      expect(getComputedStyle(article).transform).toBe('none');

      (await findSettingsLink()).focus();
      await userEvent.tab();
      expect(myBooks().contains(document.activeElement)).toBe(false);
    });

    it('asks only the child’s own api, never the parents’', async () => {
      const paths = recordApiPaths();
      await renderChildHome();
      await findMyBooksHeading();

      expect(paths).toContain('/api/child/books');
      expect(paths.filter((path) => path.startsWith('/api/families/'))).toEqual([]);
    });

    it('greets the child with 还没有书 while no books are assigned', async () => {
      stubChildBooks(NO_BOOKS);
      await renderChildHome();

      expect(await screen.findByRole('heading', { level: 2, name: '还没有书' })).toBeTruthy();
      expect(document.title).toBe('好奇星球');
      expect(screen.getByRole('img', { name: '好奇星球' })).toBeTruthy();
      expect(screen.getByText('你好，小米！')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('我是小兔老师');
      expect(screen.getByText('家长给你分派书以后，会出现在这里。')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: /^我的书/ })).toBeNull();
      expect(screen.queryByRole('navigation')).toBeNull();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-home');
    });

    it('reads the books again when the window comes back to the front', async () => {
      const library = freshLibrary();
      const { fixture } = await renderChildHome();
      await findMyBooksHeading();

      library.owned.get('robot-maze')?.push(XIAOMI_ID);
      library.owned.set('write-a-diary', []);
      backToFront();
      await fixture.whenStable();

      expect(
        await screen.findByRole('heading', { level: 2, name: /^我的书\s*，3 本新书$/ }),
      ).toBeTruthy();
      expect(titles()).toEqual([
        '让小机器人走出迷宫',
        '胡萝卜数数大冒险',
        '四季里的古诗',
        '形状捉迷藏',
        '小兔数萝卜',
      ]);
      expect(coverTags('让小机器人走出迷宫')).toEqual(['新']);
    });

    it('keeps the books shown when reading them again fails', async () => {
      const { fixture } = await renderChildHome();
      await findMyBooksHeading();

      stubError('get /api/child/books', 500, 'internal');
      backToFront();
      await fixture.whenStable();

      expect(titles()).toEqual(XIAOMI_TITLES);
      expect(screen.queryByRole('heading', { name: '页面没能打开' })).toBeNull();
      expect(document.querySelector('app-toast-outlet')?.childElementCount ?? 0).toBe(0);
    });

    it('says the page did not open when the books cannot be read, keeps the top bar, and retries', async () => {
      stubError('get /api/child/books', 500, 'internal');
      await renderChildHome();

      expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
      expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();
      expect(screen.getByRole('banner').contains(await findSettingsLink())).toBe(true);
      expect(screen.queryByText('你好，小米！')).toBeNull();
      await expectNoAxeViolations();
      await expectScreenshotsAtEverySize('child-home-error');

      freshLibrary();
      await userEvent.click(screen.getByRole('button', { name: '重试' }));

      await findMyBooksHeading();
      expect(titles()).toEqual(XIAOMI_TITLES);
      expect(screen.queryByRole('heading', { name: '页面没能打开' })).toBeNull();
    });

    it('goes to the child login when the books say the login has ended', async () => {
      stubError('get /api/child/books', 401, 'unauthenticated');
      stubRemembered();
      const { router } = await renderChildHome();

      await expectChildLogin(router);
    });
  });

  describe('the top bar', () => {
    it("holds the full logo and the child's avatar, which leads to the child's own settings", async () => {
      await renderChildHome();
      await findMyBooksHeading();

      const bar = screen.getByRole('banner');
      expect(within(bar).getByRole('img', { name: '好奇星球' })).toBeTruthy();
      const settings = await findSettingsLink();
      expect(bar.contains(settings)).toBe(true);
      expect(settings.getAttribute('href')).toBe('/child/profile');
      expect(settings.getAttribute('aria-current')).toBeNull();
      expect(settings.classList).not.toContain('bg-tint');
      const avatar = settings.querySelector('app-avatar');
      expect(avatar?.textContent).toBe('小');
      expect(avatar?.classList).toContain('bg-fuchsia');
      expect(settings.textContent).toContain('小米');
    });

    it('has no way to sign out: the child signs out in the settings', async () => {
      await renderChildHome();
      await findMyBooksHeading();

      expect(within(screen.getByRole('banner')).queryAllByRole('button')).toEqual([]);
      expect(screen.queryByRole('button', { name: /退出/ })).toBeNull();
    });

    it('shows the nickname a parent changed meanwhile once the window comes back to the front', async () => {
      const { fixture } = await renderChildHome();
      await findMyBooksHeading();

      stubChildSignedIn({
        id: XIAOMI_ID,
        nickname: '米米',
        account: 'xiaomi',
        familyName: '林悦的家',
      });
      backToFront();
      await fixture.whenStable();

      expect(await screen.findByText('你好，米米！')).toBeTruthy();
      expect((await findSettingsLink()).querySelector('app-avatar')?.textContent).toBe('米');
    });
  });

  it('gives the welcome banner no entrance', async () => {
    await renderChildHome();

    const banner = document.querySelector('app-welcome-banner');
    expect(banner?.getAnimations({ subtree: true })).toEqual([]);
  });

  it('sends a browser without a signed-in child to the child login', async () => {
    stubVisitor();
    stubRemembered();
    const { router } = await renderApp('/child/home');

    expect(router.url).toBe('/child');
    expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
  });

  it('goes to the child login when the login has ended meanwhile', async () => {
    const { router, fixture } = await renderChildHome();
    stubNoChild();
    stubRemembered();

    backToFront();
    await fixture.whenStable();

    await expectChildLogin(router);
  });

  it('says the page did not open when the child cannot be loaded, and retries with the books', async () => {
    stubVisitor();
    stubError('get /api/child/me', 500, 'internal');
    await renderApp('/child/home');

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText(`错误编号 ${ERROR_NUMBER}`)).toBeTruthy();

    stubChildSignedIn();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    await expectChildHome('小米');
    await findMyBooksHeading();
    expect(titles()).toEqual(XIAOMI_TITLES);
  });
});
