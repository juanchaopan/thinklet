import { acquiredMark, assignDialog, assignLabel, avatarStack, bookCover, dashedPlus, gradeRange } from './books.mjs';
import { problem } from './pages-misc.mjs';
import { bookById } from './sample-books.mjs';
import { BACK, CHILDREN, appShell, btnDanger, btnPrimary, btnSecondary, btnText, chevron, dialog, page } from './ui.mjs';

// The book page, /books/<id>: the book's own page. A hero band coloured by
// the cover holds the cover as a book, the grades and subject, the title and
// the actions: 获取 while the family does not have the book, and once it
// does, ✓ 已获取 with the button for choosing which children may read it.
// What the book is about follows under the hero.

const titleOf = (book) => `${book.title} - 好奇星球`;

/**
 * The cover as a book: corners rounder on the open side than at the spine,
 * a shaded spine with a thin crease beside it, and a deep soft shadow that
 * lifts it off the page.
 */
const bookObject = (book, width) => `
<div class="${width} shrink-0">
  <div class="relative rounded-l-md rounded-r-2xl shadow-[0_28px_48px_-18px_rgb(22_26_43/0.5),0_6px_14px_rgb(22_26_43/0.12)]">
    ${bookCover(book, { cls: 'rounded-l-md rounded-r-2xl' })}
    <span aria-hidden="true" class="pointer-events-none absolute inset-y-0 left-0 w-5 rounded-l-md bg-gradient-to-r from-ink/30 via-ink/10 to-transparent"></span>
    <span aria-hidden="true" class="pointer-events-none absolute inset-y-0 left-5 w-px bg-surface/40"></span>
  </div>
</div>`;

/**
 * The cover's own colour, spread soft behind the hero: the cover picture
 * blown up and blurred, so no colour is added that the cover does not have;
 * a book without a cover yet takes the tint colour. The layer thins out
 * towards its bottom edge, so the band melts into the page instead of ending
 * on a line.
 */
const coverGlow = (book) => `
<div aria-hidden="true" class="absolute inset-0 overflow-hidden opacity-80 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]">
  ${book.cover ? `<img src="../covers/${book.id}/cover.png" alt="" class="size-full scale-150 object-cover opacity-70 blur-3xl" />` : '<div class="size-full bg-tint"></div>'}
</div>`;

const pill = (text) => `<span class="rounded-full bg-surface/85 px-3 py-1 text-sm font-bold text-ink-soft ring-1 ring-line">${text}</span>`;

const retiredNote = (book) => {
  if (!book.retired) return '';
  const replacement = bookById(book.replacement);
  return `<p class="mb-5 rounded-2xl bg-sun px-4 py-3 text-sm text-sun-ink">这本书已下架。可以换成<a href="#" class="inline-block font-bold underline underline-offset-2">《${replacement.title}》</a></p>`;
};

/**
 * Who may read the book, as one capsule that opens the assign dialog: the
 * children's avatars and names, or the dashed plus and 选择谁能读 while nobody
 * has it. With no children in the family there is nobody to choose, so it
 * says so and offers to add a child instead.
 */
const whoCanRead = (book, children) => {
  if (!children.length) {
    return `<span class="flex flex-wrap items-center justify-center gap-x-1"><span class="text-sm text-ink-muted">还没有孩子</span>${btnText('去添加孩子', 'px-2 text-ink underline underline-offset-4')}</span>`;
  }
  const names = book.assigned.map((i) => children[i].name);
  const content = names.length
    ? `${avatarStack(book, 'size-8 text-xs ring-2 ring-surface', '-space-x-2')}<span class="truncate">${names.join('、')}可以读</span>`
    : `${dashedPlus}<span>选择谁能读</span>`;
  return `<button type="button" aria-label="${assignLabel(book)}" class="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pr-3 pl-1.5 text-sm font-bold shadow-card hover:bg-canvas">${content}${chevron()}</button>`;
};

const actions = (book, children) =>
  book.acquired
    ? `<div class="flex flex-wrap items-center justify-center gap-3 sm:justify-start"><span class="inline-flex min-h-11 items-center rounded-full bg-mint px-4">${acquiredMark()}</span>${whoCanRead(book, children)}</div>`
    : btnPrimary('获取', 'w-full sm:w-auto sm:min-w-48');

// A book leaves 我家的书 only while no child has it, so the button is not
// shown at all while any child does.
const removeLine = (book, children) =>
  book.acquired && !book.assigned.some((i) => i < children.length)
    ? `<div class="mt-10 flex justify-end border-t border-line pt-4">${btnText('从我家的书里移除', 'text-rose-ink')}</div>`
    : '';

/**
 * The hero spans the content area from edge to edge and from the top. The
 * cover stands at its left as a book, with the grades and subject, the title
 * in very large type and the actions beside it, lined up with the cover's
 * foot; on phones everything is centred under the cover. A retired book's
 * notice heads the details. The introduction follows as body text under its
 * own heading, with removing the book, when allowed, last.
 */
const bookBody = (book, children) => `
<div class="stagger flex flex-col">
  <section class="relative -mx-4 -mt-4 px-4 pt-3 pb-14 sm:-mx-6 sm:px-6 sm:pb-16 lg:-mx-10 lg:-mt-20 lg:px-10 lg:pt-10 lg:pb-20">
    ${coverGlow(book)}
    <div class="relative mx-auto max-w-5xl">
      ${btnText(`${BACK}返回`, '-ml-3 pl-2')}
      <div class="mt-4 flex flex-col items-center gap-8 sm:flex-row sm:items-end sm:gap-10 lg:mt-8 lg:gap-14">
        ${bookObject(book, 'w-44 sm:w-52 lg:w-64')}
        <div class="flex min-w-0 flex-1 flex-col items-center text-center sm:items-start sm:pb-2 sm:text-left">
          ${retiredNote(book)}
          <div class="flex flex-wrap justify-center gap-2 sm:justify-start">${pill(gradeRange(book))}${pill(book.subject)}</div>
          <h1 class="mt-4 text-4xl leading-tight font-black tracking-tight sm:text-5xl">${book.title}</h1>
          <div class="mt-7 w-full sm:w-auto">${actions(book, children)}</div>
        </div>
      </div>
    </div>
  </section>
  <section class="mx-auto w-full max-w-5xl">
    <div class="max-w-2xl">
      <h2 class="text-xl font-black">这本书讲什么</h2>
      <p class="mt-3 text-lg leading-loose text-ink-soft">${book.intro}</p>
    </div>
    ${removeLine(book, children)}
  </section>
</div>`;

const bookPage = (book, { children = CHILDREN, overlay = '' } = {}) =>
  page(titleOf(book), appShell({ active: 'library', content: bookBody(book, children), overlay }));

const NOT_ACQUIRED = bookById('garden-rhymes');
const ACQUIRED = bookById('carrot-counting');
const UNASSIGNED = bookById('moon-phases');
const RETIRED = bookById('bunny-counts');

const notFound = appShell({
  active: 'library',
  content: problem({ iconName: 'search', title: '找不到这本书', action: '回到书库' }),
});

// The question names the book, so it takes the wide dialog to keep a long
// title on as few lines as possible.
const removeDialog = dialog({
  iconName: 'door',
  title: `从我家的书里移除《${UNASSIGNED.title}》？`,
  wide: true,
  body: '<p class="mt-3 text-base text-ink-soft">这本书还在书库里时，可以再获取。</p>',
  actions: `${btnSecondary('取消')}${btnDanger('移除')}`,
});

export default [
  { name: 'book', html: bookPage(NOT_ACQUIRED) },
  { name: 'book-acquired', html: bookPage(ACQUIRED) },
  { name: 'book-acquired-unassigned', html: bookPage(UNASSIGNED) },
  { name: 'book-retired', html: bookPage(RETIRED) },
  { name: 'book-no-children', html: bookPage(UNASSIGNED, { children: [] }) },
  { name: 'book-not-found', html: page('找不到这本书 - 好奇星球', notFound) },
  { name: 'dialog-assign-book', viewportOnly: true, html: bookPage(ACQUIRED, { overlay: assignDialog(ACQUIRED) }) },
  { name: 'dialog-remove-book', viewportOnly: true, html: bookPage(UNASSIGNED, { overlay: removeDialog }) },
];
