import { assignDialog, bookCard, bookGrid, cardMenuSheet } from './books.mjs';
import { BOOKS, GRADES, LIBRARY, SUBJECTS, bookById, coversGrade } from './sample-books.mjs';
import { ADMIN, CHECK, CHILDREN, appShell, art, avatar, btnPrimary, btnSecondary, btnText, card, chevron, icon, menuSheet, page } from './ui.mjs';

// The library, the home page of the current family at `/`: a short welcome,
// three filters and the books, newest first, 12 at a time. With a mouse the
// next 12 come with 加载更多 under the grid; on touch screens they load as the
// grid's end scrolls into view.

const TITLE = '好奇星球';
const BATCH = 12;

// Join requests waiting for 林悦: one in 林悦的家 and one in another family
// she is the admin of.
const COUNTS = { pending: 1, pendingAll: 2 };

/**
 * A short welcome banner: the greeting and one line of what to do here, with
 * the half-body rabbit waving from the right edge and cut off at its waist by
 * the banner's bottom edge. It is lower than a child's banner, so the books
 * start high on the page.
 */
const libraryBanner = (name) => `
<section class="relative overflow-hidden rounded-card bg-gradient-to-r from-surface via-peach/60 to-tint ring-1 ring-line">
  <div class="relative z-[1] py-5 pr-28 pl-5 sm:py-6 sm:pr-48 sm:pl-8">
    <h1 class="text-xl leading-snug font-black sm:text-2xl">欢迎回来，${name}</h1>
    <p class="mt-1 text-sm text-ink-soft sm:text-base">挑几本书，分派给孩子吧。</p>
  </div>
  <div aria-hidden="true" class="absolute right-1 -bottom-5 w-24 animate-rabbit [animation-delay:120ms] sm:right-10 sm:-bottom-6 sm:w-32 lg:right-14">${art('rabbitWave', 'w-full')}</div>
</section>`;

// ---- Which books the filters let through ----

/** 书库, 我家的书, or one child's books. */
const scopeBooks = (scope) => {
  if (scope === '书库') return LIBRARY;
  if (scope === '我家的书') return BOOKS.filter((b) => b.acquired);
  const child = CHILDREN.findIndex((c) => c.name === scope);
  return BOOKS.filter((b) => b.assigned.includes(child));
};

/** A book passes the grades when none are chosen, or when any chosen grade falls in its range. */
const inGrades = (book, chosen) => !chosen.length || chosen.some((g) => coversGrade(book, g));

const inAny = (value, chosen) => !chosen.length || chosen.includes(value);

/**
 * The books under the three filters. Grades and subjects take any number of
 * values, and none chosen means all. `pool` is what the scope and grades let
 * through: the subjects offered are the ones it holds.
 */
const filterBooks = ({ scope, grades, subjects }) => {
  const pool = scopeBooks(scope).filter((b) => inGrades(b, grades));
  return { pool, books: pool.filter((b) => inAny(b.subject, subjects)) };
};

// ---- Filter buttons and their menus ----

/** "全部" with nothing chosen, the values themselves for one or two, a count from three. */
const chosenLabel = (chosen) => (!chosen.length ? '全部' : chosen.length <= 2 ? chosen.join('、') : `${chosen.length} 个`);

/**
 * A filter's button shows its current value. A filter that narrows the books
 * is tinted, so a narrowed list is seen at a glance; the open one is ringed.
 * Phones get a little less padding, so the three buttons fit on one line
 * while their values are short.
 */
const filterButton = (text, { open = false, narrowed = false } = {}) =>
  `<button type="button" aria-haspopup="true" aria-expanded="${open}" class="inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-bold whitespace-nowrap transition-colors duration-100 sm:gap-1.5 sm:px-4 ${
    open ? 'border-violet bg-surface ring-2 ring-violet/20' : narrowed ? 'border-violet/40 bg-tint text-ink' : 'border-line-strong bg-surface hover:bg-canvas'
  }">${text}${chevron('size-4 text-ink-muted')}</button>`;

const tick = `<span class="shrink-0 text-violet">${CHECK}</span>`;

/**
 * One grade or subject: a bordered tile that toggles. A chosen tile takes the
 * tint background and the violet tick, as the chosen scope does.
 */
const tile = (text, chosen, extra = '') =>
  `<button type="button" role="checkbox" aria-checked="${chosen}" class="flex min-h-11 items-center gap-1 rounded-xl border px-3 font-bold ${
    chosen ? 'border-violet/30 bg-tint' : 'border-line hover:bg-canvas'
  } ${extra}"><span class="min-w-0 flex-1 text-left">${text}</span>${chosen ? tick : ''}</button>`;

// Grades sit three to a row, one school stage per row, so all thirteen fit
// under the button without scrolling.
const gradeOptions = ({ grades }) => `
<div class="grid grid-cols-3 gap-1.5">
  ${GRADES.map((g, i) => tile(g, grades.includes(g), `px-2.5 text-sm ${i === 1 ? 'col-start-1' : ''}`)).join('')}
</div>`;

const subjectOptions = ({ subjects, pool }) => `
<div class="grid grid-cols-2 gap-1.5">
  ${SUBJECTS.filter((s) => pool.some((b) => b.subject === s))
    .map((s) => tile(s, subjects.includes(s)))
    .join('')}
</div>`;

const SCOPES = [
  { value: '书库', mark: icon('home', 'size-7') },
  { value: '我家的书', mark: icon('family', 'size-7') },
  ...CHILDREN.map((c) => ({ value: c.name, mark: avatar(c.name, c.color, 'size-7 text-xs') })),
];

/** The scope takes one value, marked with the selection tick. */
const scopeOptions = ({ scope }) =>
  SCOPES.map(
    (s, i) =>
      `${i === 2 ? '<div class="my-1 border-t border-line"></div>' : ''}<a href="#" role="menuitemradio" aria-checked="${scope === s.value}" class="flex min-h-11 items-center gap-3 rounded-xl px-3 font-bold ${
        scope === s.value ? 'bg-tint' : 'hover:bg-canvas'
      }">${s.mark}<span>${s.value}</span>${scope === s.value ? `<span class="ml-auto text-violet">${CHECK}</span>` : ''}</a>`,
  ).join('');

/**
 * Grades and subjects apply as they are chosen; 清除 clears them all and 完成
 * closes the menu. In a drop-down the two share one compact row; in a sheet
 * they follow the dialogs: stacked with 完成 on top below 640 px, in a row to
 * the right from 640 px.
 */
const MULTI_ACTIONS = {
  drop: `<div class="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">${btnText('清除')}${btnPrimary('完成', 'min-h-11 px-5 text-sm')}</div>`,
  sheet: `<div class="mt-3 flex flex-col-reverse gap-3 border-t border-line px-1 pt-3 sm:flex-row sm:justify-end">${btnSecondary('清除')}${btnPrimary('完成')}</div>`,
};

const FILTERS = {
  grade: { label: '年级', width: 'w-80', options: gradeOptions, multi: true },
  subject: { label: '学科', width: 'w-64', options: subjectOptions, multi: true },
  scope: { label: '范围', width: 'w-56', options: scopeOptions, multi: false },
};

/**
 * A filter's menu. With a mouse it drops down from the button; on touch
 * screens it rises in a sheet headed by the filter's name.
 */
const dropPanel = (key, state) => {
  const f = FILTERS[key];
  return `<div role="group" aria-label="${f.label}" class="${f.width} rounded-2xl border border-line bg-surface p-1.5 shadow-pop">${f.options(state)}${f.multi ? MULTI_ACTIONS.drop : ''}</div>`;
};

const sheetPanel = (key, state) => {
  const f = FILTERS[key];
  return menuSheet(
    `<div role="group" aria-label="${f.label}" class="rounded-3xl bg-surface p-2">
       <p class="px-3 pt-2 pb-3 text-lg font-black">${f.label}</p>
       ${f.options(state)}
       ${f.multi ? MULTI_ACTIONS.sheet : ''}
     </div>`,
    'mouse:hidden',
  );
};

const dropdown = (button, panel) => `
<div class="relative">
  ${button}
  ${panel ? `<div class="absolute top-full left-0 z-10 mt-2 hidden origin-top-left animate-drop mouse:block">${panel}</div>` : ''}
</div>`;

// The filter row stands above the grid, so its drop-down menus cover the books.
const filterRow = (state) => {
  const { grades, subjects, scope, open } = state;
  const panel = (key) => (open === key ? dropPanel(key, state) : '');
  return `
<div class="relative z-[2] flex flex-wrap gap-2">
  ${dropdown(filterButton(`年级：${chosenLabel(grades)}`, { open: open === 'grade', narrowed: grades.length > 0 }), panel('grade'))}
  ${dropdown(filterButton(`学科：${chosenLabel(subjects)}`, { open: open === 'subject', narrowed: subjects.length > 0 }), panel('subject'))}
  ${dropdown(filterButton(scope, { open: open === 'scope', narrowed: scope !== '书库' }), panel('scope'))}
</div>`;
};

const emptyCard = card(`
  <div class="flex flex-col items-center gap-2 py-8 text-center">
    ${icon('seedling', 'size-16')}
    <h2 class="mt-2 text-lg font-black">没有符合条件的书</h2>
    <div class="mt-4">${btnPrimary('清除筛选')}</div>
  </div>`);

// Touch screens load the next books by scrolling, so 加载更多 is shown with a
// mouse only; once every book is shown, a short line says so instead.
const listEnd = (end) =>
  end
    ? '<p class="py-2 text-center text-sm text-ink-muted">全部的书都在这里了</p>'
    : `<div class="hidden justify-center mouse:flex">${btnSecondary('加载更多', 'min-w-48')}</div>`;

const DEFAULTS = { grades: [], subjects: [], scope: '书库', all: false, open: '', menuFor: '' };

/**
 * The library page; `all` shows every batch already loaded, and `menuFor`
 * names the book whose card menu is open.
 */
const libraryBody = (options = {}) => {
  const state = { ...DEFAULTS, ...options };
  const { pool, books } = filterBooks(state);
  const shown = state.all ? books : books.slice(0, BATCH);
  return `
<div class="stagger mx-auto flex w-full max-w-5xl flex-col gap-5">
  ${libraryBanner(ADMIN.name)}
  ${filterRow({ ...state, pool })}
  ${shown.length ? bookGrid(shown.map((b) => bookCard(b, { menuOpen: b.id === state.menuFor }))) : emptyCard}
  ${shown.length ? listEnd(shown.length === books.length) : ''}
</div>`;
};

/** The library as it first opens, behind the menus and dialogs opened from the navigation. */
export const libraryHome = libraryBody();

const libraryPage = (options, overlay = '') => appShell({ active: 'library', ...COUNTS, content: libraryBody(options), overlay });

const withSheet = (options) => {
  const state = { ...DEFAULTS, ...options };
  return libraryPage(options, sheetPanel(options.open, { ...state, pool: filterBooks(state).pool }));
};

const CARROTS = bookById('carrot-counting');
const RETIRED = bookById('bunny-counts');
const MOON = bookById('moon-phases');

export default [
  { name: 'library', html: page(TITLE, libraryPage({})) },
  { name: 'library-entering', frames: [0, 120, 300, 620], html: page(TITLE, libraryPage({})) },
  { name: 'library-end', html: page(TITLE, libraryPage({ all: true })) },
  { name: 'library-filter-grade', viewportOnly: true, html: page(TITLE, withSheet({ open: 'grade', grades: ['一年级', '二年级'] })) },
  { name: 'library-filter-subject', viewportOnly: true, html: page(TITLE, withSheet({ open: 'subject', subjects: ['数学'] })) },
  { name: 'library-scope', viewportOnly: true, html: page(TITLE, withSheet({ open: 'scope' })) },
  { name: 'library-my-family', html: page(TITLE, libraryPage({ scope: '我家的书', all: true })) },
  { name: 'library-empty', html: page(TITLE, libraryPage({ grades: ['高一'] })) },
  { name: 'library-card-menu', viewportOnly: true, html: page(TITLE, libraryPage({ menuFor: MOON.id }, cardMenuSheet(MOON))) },
  { name: 'dialog-assign', viewportOnly: true, html: page(TITLE, libraryPage({}, assignDialog(CARROTS))) },
  { name: 'dialog-assign-changed', viewportOnly: true, html: page(TITLE, libraryPage({}, assignDialog(CARROTS, [...CARROTS.assigned, 2]))) },
  { name: 'dialog-assign-retired', viewportOnly: true, html: page(TITLE, libraryPage({ scope: '我家的书', all: true }, assignDialog(RETIRED))) },
];
