import { CHECK, CHILDREN, MORE, avatar, bookIcon, btnIcon, btnPrimary, btnSecondary, dialog, icon, menuSheet } from './ui.mjs';

// Books as the library, the book page and a child's home page show them, and
// the dialog that chooses which children may read a book.

/**
 * The grades a book is for: one grade, or "四年级～初二" from the lowest to the
 * highest. The full-width tilde keeps apart grades that start with 一, where
 * a dash would run into the stroke. Screen readers would read the tilde as a
 * symbol or skip it, so they hear "四年级到初二" instead of what is drawn.
 */
export const gradeRange = (book) =>
  book.minGrade === book.maxGrade
    ? book.minGrade
    : `<span aria-hidden="true">${book.minGrade}～${book.maxGrade}</span><span class="sr-only">${book.minGrade}到${book.maxGrade}</span>`;

/** "四年级～初二 · 数学", the line under every book title. */
export const gradeAndSubject = (book) => `${gradeRange(book)} · ${book.subject}`;

const SMALL_CHECK = `<svg class="size-4" viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.6 3.4L15.5 6.5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const PLUS = `<svg class="size-4" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

/** "✓ 已获取", shown where a book the family has would offer 获取. */
export const acquiredMark = (cls = 'text-sm') =>
  `<span class="inline-flex items-center gap-1 font-bold whitespace-nowrap text-mint-ink ${cls}">${SMALL_CHECK}已获取</span>`;

const tag = (text, cls) => `<span class="absolute top-2 rounded-full px-2.5 py-1 text-xs font-bold shadow-card ${cls}">${text}</span>`;

/**
 * A cover at 3:4. A book without its own cover yet shows the default one: the
 * tint colour with a large line book in the middle. A retired book carries
 * 已下架 at the top left; a book the child has not opened yet carries 新 at
 * the top right.
 */
export const bookCover = (book, { isNew = false, cls = '' } = {}) => `
<div class="relative aspect-[3/4] w-full overflow-hidden ${cls}">
  ${
    book.cover
      ? `<img src="../covers/${book.id}/cover.png" alt="" class="block size-full object-cover" />`
      : `<div class="flex size-full items-center justify-center bg-tint text-primary">${bookIcon('aspect-square w-1/3')}</div>`
  }
  ${book.retired ? tag('已下架', 'left-2 bg-surface text-ink-soft') : ''}
  ${isNew ? tag('新', 'right-2 bg-badge text-white') : ''}
</div>`;

// On phones the cards are narrowest, so the avatars there are a size smaller
// and overlap more, which keeps three avatars and a count beside 已获取.
const SMALL_AVATAR = 'size-6 text-[11px] ring-2 ring-surface sm:size-7 sm:text-xs';

/** The children a book is assigned to as overlapping avatars: at most three, then a count of the rest. */
export const avatarStack = (book, size = SMALL_AVATAR, overlap = '-space-x-2 sm:-space-x-1.5') => {
  const shown = book.assigned.slice(0, 3);
  const more = book.assigned.length - shown.length + book.extraAssigned;
  return `<span class="flex ${overlap}">${shown.map((i) => avatar(CHILDREN[i].name, CHILDREN[i].color, size)).join('')}${
    more ? `<span class="inline-flex shrink-0 items-center justify-center rounded-full bg-canvas font-bold text-ink-soft ${size}">+${more}</span>` : ''
  }</span>`;
};

/** A 32 px dashed circle with a plus: nobody has been chosen yet. */
export const dashedPlus = `<span class="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-ink-muted">${PLUS}</span>`;

/** The name screen readers give every button that opens a book's assign dialog. */
export const assignLabel = (book) => `管理谁能读《${book.title}》`;

/**
 * The button that opens the assign dialog, on a library card and on the book
 * page: the avatars of the children who have the book, or the dashed plus
 * while nobody has it. Either way the target is 44 px high; on a card it sits
 * above the card's link.
 */
export const assignButton = (book) =>
  `<button type="button" aria-label="${assignLabel(book)}" class="relative z-[1] inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-1 transition duration-100 hover:bg-canvas active:scale-[0.97] sm:px-1.5">${
    book.assigned.length ? avatarStack(book) : dashedPlus
  }</button>`;

const REMOVE = '从我家的书里移除';

/**
 * The actions of a book the family has but no child reads: only removing it
 * from 我家的书. With a mouse they drop down from the card's … button; on
 * touch screens they rise in a sheet headed by the book's cover and title,
 * like the actions of a member or a child.
 */
const cardDropMenu = `
<div role="menu" class="absolute top-14 right-2 z-10 hidden w-56 origin-top-right animate-drop rounded-2xl border border-line bg-surface p-1.5 shadow-pop mouse:block">
  <a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold text-rose-ink hover:bg-canvas">${icon('door', 'size-6')}${REMOVE}</a>
</div>`;

export const cardMenuSheet = (book) =>
  menuSheet(
    `<div role="menu" aria-label="《${book.title}》的操作" class="rounded-3xl bg-surface p-2">
       <div class="flex items-center gap-3 px-3 py-3">
         <div class="w-10 shrink-0">${bookCover(book, { cls: 'rounded-md ring-1 ring-line' })}</div>
         <p class="min-w-0 flex-1 truncate font-bold">${book.title}</p>
       </div>
       <div class="my-1 border-t border-line"></div>
       <a href="#" role="menuitem" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-bold text-rose-ink hover:bg-canvas">${icon('door', 'size-7')}${REMOVE}</a>
     </div>`,
    'mouse:hidden',
  );

/**
 * A book in a grid: the cover, the title in at most two lines, the grades and
 * subject, and the introduction in at most two lines. On the parents' pages
 * the whole card leads to the book page, and its footer offers 获取, or shows
 * that the family has the book with the button that chooses which children
 * may read it. A book the family has but no child reads also carries a …
 * button over the cover's top right, for removing it. Every button sits above
 * the card's link, so pressing it does not open the book. A child's cards
 * have no footer and lead nowhere yet. The card does not clip its content, so
 * an open drop-down can reach past it; the cover rounds its own top corners.
 */
export const bookCard = (book, { footer = true, link = true, isNew = false, menuOpen = false } = {}) => {
  const removable = footer && book.acquired && !book.assigned.length && !book.extraAssigned;
  return `
<article class="relative flex flex-col rounded-card border border-line bg-surface shadow-card ${menuOpen ? 'z-[3]' : ''} ${
    link ? 'transition duration-150 mouse:hover:-translate-y-0.5 mouse:hover:shadow-pop' : ''
  }">
  ${bookCover(book, { isNew, cls: 'rounded-t-[calc(var(--radius-card)-1px)]' })}
  ${removable ? `<span class="absolute top-2 right-2 z-[1]">${btnIcon(MORE, '更多操作', `${menuOpen ? 'bg-canvas' : 'bg-surface/90'} shadow-card`)}</span>` : ''}
  ${menuOpen ? cardDropMenu : ''}
  <div class="flex flex-1 flex-col p-3 sm:p-4">
    <h3 class="line-clamp-2 text-base leading-snug font-black">${
      link ? `<a href="#" class="outline-none after:absolute after:inset-0 after:content-['']">${book.title}</a>` : book.title
    }</h3>
    <p class="mt-1 text-xs font-bold text-ink-muted">${gradeAndSubject(book)}</p>
    <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">${book.intro}</p>
    ${
      footer
        ? `<div class="mt-auto flex min-h-11 items-center gap-1 pt-3 sm:gap-2">${
            book.acquired
              ? `${acquiredMark()}<span class="-mr-1 ml-auto sm:-mr-1.5">${assignButton(book)}</span>`
              : btnPrimary('获取', 'relative z-[1] min-h-11 px-5 text-sm')
          }</div>`
        : ''
    }
  </div>
</article>`;
};

/** Book cards two to a row on phones, three on tablets and four where the content is widest. */
export const bookGrid = (cards) => `
<div class="@container">
  <div class="grid grid-cols-2 gap-3 @xl:grid-cols-3 @xl:gap-4 @4xl:grid-cols-4">${cards.join('')}</div>
</div>`;

// Each child is one row, the whole row being the target. A chosen child's
// row is tinted and ends in the violet tick, like the chosen entry of a menu.
// A retired book cannot go to anyone new, so the rows of children who do not
// have it are faded and cannot be pressed; those who have it can still be
// taken off.
const childRow = (child, chosen, disabled) => `
<li>
  <button type="button" role="checkbox" aria-checked="${chosen}"${disabled ? ' disabled' : ''} class="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left ${
    disabled ? 'cursor-not-allowed opacity-45' : chosen ? 'bg-tint' : 'hover:bg-canvas'
  }">
    ${avatar(child.name, child.color, 'size-10 text-base')}
    <span class="min-w-0 flex-1 truncate text-base font-bold">${child.name}</span>
    ${chosen ? `<span class="text-violet">${CHECK}</span>` : ''}
  </button>
</li>`;

const sameChildren = (a, b) => a.length === b.length && a.every((i) => b.includes(i));

/**
 * Choosing which children may read a book. `chosen` holds the children ticked
 * so far, starting from those who have the book. 确定 appears only once the
 * choice differs from what it was when the dialog opened; until then 取消 is
 * the one way out.
 */
export const assignDialog = (book, chosen = book.assigned) =>
  dialog({
    title: `谁能读《${book.title}》`,
    wide: true,
    body: `<ul class="mt-4 flex flex-col gap-1">${CHILDREN.map((c, i) => childRow(c, chosen.includes(i), book.retired && !book.assigned.includes(i))).join('')}</ul>
    ${book.retired ? '<p class="mt-3 px-3 text-sm text-ink-muted">下架的书不能再分派</p>' : ''}`,
    actions: sameChildren(chosen, book.assigned) ? btnSecondary('取消') : `${btnSecondary('取消')}${btnPrimary('确定')}`,
  });
