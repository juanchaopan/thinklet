// Shared building blocks for the static prototype pages.
//
// Interaction patterns follow the input type through the `touch:` and
// `mouse:` variants (pointer: coarse / fine), never the width: on touch,
// dialogs and menus rise from the bottom as floating sheets and names are
// edited in a sheet; with a mouse, dialogs sit in the middle, menus drop down
// from their button, names are edited in place and icon buttons show tooltips.
import { existsSync } from 'node:fs';
import { logoImage, logoMark } from './logos.mjs';

const artDir = new URL('../art/', import.meta.url);

/** One of the project's own icons, art/icon-<name>.png. */
export const icon = (name, cls = 'size-7') =>
  `<img src="../art/icon-${name}.png" alt="" class="${cls} shrink-0 object-contain select-none" />`;

const ARTWORK = {
  rabbit: 'rabbit.webp',
  rabbitWave: 'rabbit-wave.png',
};

/** A picture of the rabbit teacher; a pose not generated yet falls back to the full-body one. */
export const art = (name, cls = 'w-full') => {
  const file = existsSync(new URL(ARTWORK[name], artDir)) ? ARTWORK[name] : ARTWORK.rabbit;
  return `<img src="../art/${file}" alt="" class="${cls} block select-none" />`;
};

const AVATAR_COLORS = ['bg-violet', 'bg-sky', 'bg-mint-ink', 'bg-fuchsia', 'bg-sun-ink'];

export const avatar = (name, colorIndex = 0, cls = 'size-9 text-sm') =>
  `<span aria-hidden="true" class="${cls} ${AVATAR_COLORS[colorIndex]} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white">${[...name][0]}</span>`;

// Buttons darken on hover and shrink slightly while pressed, both in 100 ms.
const press = 'transition duration-100 ease-[var(--ease-move)] active:scale-[0.97]';

export const btnPrimary = (text, extra = '') =>
  `<button type="button" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-bold text-white hover:bg-primary-hover ${press} ${extra}">${text}</button>`;

export const btnSecondary = (text, extra = '') =>
  `<button type="button" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-6 text-base font-bold text-ink hover:bg-canvas ${press} ${extra}">${text}</button>`;

export const btnDanger = (text, extra = '') =>
  `<button type="button" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-rose-ink px-6 text-base font-bold text-white ${press} ${extra}">${text}</button>`;

export const btnText = (text, extra = '') =>
  `<button type="button" class="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold text-ink-soft hover:bg-canvas ${press} ${extra}">${text}</button>`;

/** A 44×44 round button holding only a symbol, with its name for screen readers. */
export const btnIcon = (svg, label, extra = '') =>
  `<button type="button" aria-label="${label}" class="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-canvas ${press} ${extra}">${svg}</button>`;

/**
 * A 44×44 outlined round button holding one of the line icons, in the primary
 * colour. Screen readers announce its name; with a mouse the same name shows
 * as a tooltip under it on hover or keyboard focus. Touch screens have no
 * tooltip.
 */
export const btnTool = (svg, label) =>
  `<button type="button" aria-label="${label}" class="group relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-primary hover:bg-canvas ${press}">${svg}<span aria-hidden="true" class="pointer-events-none absolute top-full left-1/2 z-10 mt-2 hidden -translate-x-1/2 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white opacity-0 shadow-pop transition-opacity duration-100 mouse:block mouse:group-hover:opacity-100 mouse:group-focus-visible:opacity-100">${label}</span></button>`;

export const PENCIL = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.8 4.2 15.8 7.2M4 16l.8-3.6L13.6 3.6a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2l-8.8 8.8L4 16Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>`;
export const MORE = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;
export const CHECK = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3L15 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const SEARCH = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
export const CLOSE = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`;
export const BACK = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4.5 6.5 10l5.5 5.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The line icons next to the family code: 20 px, 1.75 px strokes with round
// caps and joins, drawn in the current colour.
const line = (paths) =>
  `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Two overlapping rounded squares; only the visible part of the back one is drawn. */
export const COPY = line(
  `<rect x="7" y="7" width="10" height="10" rx="2.25"/><path d="M13 7V5.25A2.25 2.25 0 0 0 10.75 3h-5.5A2.25 2.25 0 0 0 3 5.25v5.5A2.25 2.25 0 0 0 5.25 13H7"/>`,
);

/** An arrow rising up out of an open box. */
export const SHARE = line(
  `<path d="M7 8.5H6a2 2 0 0 0-2 2V15a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2h-1"/><path d="M10 12V2.75M6.75 6 10 2.75 13.25 6"/>`,
);

/** Three finder corners and three small modules in the fourth corner. */
export const QR = line(
  `<rect x="3" y="3" width="5.5" height="5.5" rx="1.25"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.25"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.25"/><g fill="currentColor" stroke="none"><rect x="11.5" y="11.5" width="2.25" height="2.25" rx=".5"/><rect x="14.75" y="11.5" width="2.25" height="2.25" rx=".5"/><rect x="14.75" y="14.75" width="2.25" height="2.25" rx=".5"/></g>`,
);

export const card = (content, extra = '') =>
  `<section class="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6 ${extra}">${content}</section>`;

export const chip = (text, tone = 'mint') => {
  const tones = {
    mint: 'bg-mint text-mint-ink',
    sun: 'bg-sun text-sun-ink',
    rose: 'bg-rose text-rose-ink',
    gray: 'bg-canvas text-ink-soft',
    violet: 'bg-violet/10 text-violet',
  };
  return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}">${text}</span>`;
};

export const badge = (count, extra = '') =>
  `<span class="inline-flex min-w-5 items-center justify-center rounded-full bg-badge px-1.5 text-xs leading-5 font-bold text-white ${extra}">${count}</span>`;

/** A red dot for news without a count, such as request results not yet seen. */
export const dot = (extra = '') => `<span class="size-2.5 shrink-0 rounded-full bg-badge ${extra}"></span>`;

export const chevron = (cls = 'size-4 text-ink-muted') =>
  `<svg class="${cls} shrink-0" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A select-like button showing the chosen time zone. */
export const timezoneField = (value = 'Asia/Shanghai（UTC+08:00）', focused = false) => `
<button type="button" class="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border bg-surface px-4 text-left text-base ${
  focused ? 'border-violet ring-2 ring-violet/20' : 'border-line-strong'
}">
  <span>${value}</span>${chevron()}
</button>`;

/**
 * A focused text box for editing a value. With an error it is empty, shakes
 * once and shows the message under it.
 */
export const textInput = (value, label, error = '') =>
  error
    ? `<input type="text" value="" aria-label="${label}" aria-invalid="true" class="block min-h-12 w-full animate-shake rounded-2xl border border-rose-ink bg-surface px-4 text-base outline-none ring-2 ring-rose" />
       <p class="mt-2 animate-fade text-sm font-bold text-rose-ink">${error}</p>`
    : `<input type="text" value="${value}" aria-label="${label}" class="block min-h-12 w-full rounded-2xl border border-violet bg-surface px-4 text-base outline-none ring-2 ring-violet/20" />`;

/**
 * Editing in place: the field with 取消 and 保存 beside it on wide screens and
 * under it on narrow ones, all fading in. With an error message under the
 * field, the buttons stay level with the field instead of its middle.
 */
export const editRow = (input, error = false) =>
  error
    ? `
<div class="flex animate-fade flex-col gap-3 sm:flex-row sm:items-start">
  <div class="flex-1">${input}</div>
  <div class="flex gap-2 sm:mt-0.5">${btnText('取消', 'flex-1 border border-line sm:flex-none')}${btnPrimary('保存', 'min-h-11 flex-1 px-5 text-sm sm:flex-none')}</div>
</div>`
    : `
<div class="flex animate-fade flex-col gap-3 sm:flex-row sm:items-center">
  <div class="flex-1">${input}</div>
  <div class="flex gap-2">${btnText('取消', 'flex-1 border border-line sm:flex-none')}${btnPrimary('保存', 'min-h-11 flex-1 px-5 text-sm sm:flex-none')}</div>
</div>`;

/** A whole page; the browser title names the page, then the product. */
export const page = (title, body) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="bg-app min-h-screen font-sans text-ink antialiased">
${body}
  </body>
</html>
`;

export const ADMIN = { name: '林悦', color: 0, email: 'linyue@example.com' };
export const MEMBER = { name: '周子航', color: 1, email: null };

/** One entry of a menu: an icon, the label and whatever follows it. */
export const menuItem = (content, extra = '') =>
  `<a href="#" role="menuitem" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base hover:bg-canvas ${extra}">${content}</a>`;

/**
 * The entries that belong to the parent rather than to a family: joining
 * another family, with a red dot while request results wait to be seen, and
 * the parent's own settings.
 */
const parentItems = (unseen) => [
  { key: 'join', label: '加入家庭', icon: 'key', dot: unseen },
  { key: 'profile', label: '个人设置', icon: 'consent' },
];

const NEWS = '<span class="sr-only">，有新的申请结果</span>';

/** The parent's menu, opened from the avatar: the parent at its head, then the parent's entries. */
export const userMenu = (parent, unseen = false) => `
<div role="menu" aria-label="${parent.name}" class="w-64 rounded-3xl border border-line bg-surface p-2 shadow-pop">
  <div class="flex items-center gap-3 px-3 py-3">${avatar(parent.name, parent.color, 'size-10 text-base')}<p class="font-bold">${parent.name}</p></div>
  <div class="my-1 border-t border-line"></div>
  ${parentItems(unseen)
    .map((item) => menuItem(`${icon(item.icon, 'size-7')}<span class="flex-1 font-bold">${item.label}</span>${item.dot ? `${dot()}${NEWS}` : ''}`))
    .join('')}
</div>`;

/**
 * The parent's avatar, with the name on wide screens, opening the parent's
 * menu. A red dot at the avatar's top right corner tells of request results
 * not yet seen; it is placed from the button's own corner, where the avatar
 * always sits, so the avatar itself is left untouched, and the button only
 * becomes the dot's positioning box while there is a dot. On the pages that
 * menu leads to, the button is shown as the current one.
 */
export const userButton = (parent, { unseen = false, current = false } = {}) => `
<button type="button" aria-haspopup="menu" aria-label="${parent.name}的菜单${unseen ? '，有新的申请结果' : ''}" class="${unseen ? 'relative ' : ''}flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-1 lg:pr-3 ${
  current ? 'bg-tint' : 'hover:bg-surface/70'
}">
  ${avatar(parent.name, parent.color)}
  <span class="hidden text-sm font-bold lg:inline">${parent.name}</span>
  ${unseen ? '<span class="absolute top-0.5 left-[1.875rem] size-3 rounded-full border-2 border-surface bg-badge"></span>' : ''}
</button>`;

/** Top bar of the pages a visitor sees before signing in: the full logo, shown large. */
export const publicShell = (content, overlay = '') => `
<div class="flex min-h-screen flex-col">
  <header class="flex h-24 items-center px-5 sm:px-8">${logoImage(72)}</header>
  <main class="flex flex-1 flex-col">${content}</main>
  ${overlay}
</div>`;

/**
 * A page for a signed-in parent who has no family yet: the full logo and the
 * avatar opening the parent's menu, no family menus.
 */
export const bareShell = (content, { overlay = '', parent = ADMIN, unseen = false } = {}) => `
<div class="flex min-h-screen flex-col">
  <header class="flex h-24 items-center px-4 sm:px-8">${logoImage(64)}<span class="ml-auto">${userButton(parent, { unseen })}</span></header>
  <main class="flex flex-1 flex-col px-4 pb-12 sm:px-8">${content}</main>
  ${overlay}
</div>`;

const familySwitcher = (family, compact = false) => `
<button type="button" class="flex w-full min-h-12 items-center gap-3 rounded-2xl border border-line bg-surface px-3 text-left hover:bg-canvas ${compact ? 'max-w-44' : ''}">
  ${icon('family', 'size-7')}
  <span class="min-w-0 flex-1">
    <span class="block truncate text-sm font-bold text-ink">${family}</span>
    ${compact ? '' : '<span class="block text-xs text-ink-muted">切换家庭</span>'}
  </span>
  ${chevron()}
</button>`;

/**
 * The family's menu entries. "新成员" is shown to the family's admin only,
 * with a red count while requests wait.
 */
const navItems = (admin, pending) => [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'family', label: '家庭管理', icon: 'settings' },
  ...(admin ? [{ key: 'members', label: '新成员', icon: 'letter', count: pending }] : []),
];

const sideLink = (item, active) =>
  `<a href="#" class="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-bold transition-colors duration-150 ${
    item.key === active ? 'bg-tint text-ink' : 'text-ink-soft hover:bg-canvas'
  }"${item.key === active ? ' aria-current="page"' : ''}>${icon(item.icon, 'size-8')}<span class="flex-1">${item.label}</span>${
    item.count ? badge(item.count) : ''
  }${item.dot ? `${dot('mr-1.5')}${NEWS}` : ''}</a>`;

/**
 * Signed-in layout.
 * - From 1024 px: a left sidebar with the logo mark, the family switcher, the
 *   family's entries and, under a divider, the parent's own group headed by
 *   the avatar and name. There is no top bar; the content keeps its distance
 *   from the top.
 * - Below 1024 px: a top bar with the logo mark, the family switcher and the
 *   avatar, which opens the parent's menu, and a bottom tab bar with the
 *   family's entries.
 * The full logo's name is not legible at navigation size, so both show the
 * mark. The pages of the parent's menu mark the avatar as current.
 */
export const appShell = ({ active, content, family = '林悦的家', parent = ADMIN, admin = true, pending = 2, unseen = false, overlay = '' }) => {
  const items = navItems(admin, pending);
  return `
<div class="min-h-screen lg:flex">
  <aside class="hidden w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface/80 px-4 py-5 backdrop-blur lg:flex">
    <div class="px-2">${logoMark(48)}</div>
    ${familySwitcher(family)}
    <nav aria-label="主菜单" class="flex flex-col gap-1">
      ${items.map((item) => sideLink(item, active)).join('')}
    </nav>
    <nav aria-label="${parent.name}" class="flex flex-col gap-1 border-t border-line pt-5">
      <div class="flex min-h-12 items-center gap-3 px-3">${avatar(parent.name, parent.color, 'size-8 text-sm')}<span class="font-bold">${parent.name}</span></div>
      ${parentItems(unseen)
        .map((item) => sideLink(item, active))
        .join('')}
    </nav>
  </aside>
  <div class="flex min-w-0 flex-1 flex-col">
    <header class="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6 lg:hidden">
      <span>${logoMark(38)}</span>
      <span class="ml-auto">${familySwitcher(family, true)}</span>
      ${userButton(parent, { unseen, current: active === 'profile' || active === 'join' })}
    </header>
    <main class="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:pt-20 lg:pb-12">${content}</main>
    <nav aria-label="主菜单" class="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" style="grid-template-columns:repeat(${items.length},minmax(0,1fr))">
      ${items
        .map(
          (item) => `<a href="#" class="relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold ${
            item.key === active ? 'text-ink' : 'text-ink-muted'
          }"${item.key === active ? ' aria-current="page"' : ''}><span class="relative">${icon(item.icon, 'size-7')}${
            item.count ? badge(item.count, 'absolute -top-1.5 -right-3') : ''
          }</span>${item.label}</a>`,
        )
        .join('')}
    </nav>
  </div>
  ${overlay}
</div>`;
};

/**
 * On touch screens every dialog and menu is a sheet floating above the bottom
 * edge: 12 px from the sides and the bottom on phones, 16 px from the bottom
 * from 640 px up, each plus the device's safe area at the bottom.
 * SHEET_FRAME spaces the backdrop layer that holds the sheet.
 */
export const SHEET_FRAME =
  'touch:px-3 touch:pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] touch:sm:pb-[calc(1rem_+_env(safe-area-inset-bottom))]';

/**
 * The floating sheet itself: at most 560 px wide and centred, all four corners
 * as round as a centred dialog's, rising from below the screen to its place.
 */
export const SHEET_PANEL = 'touch:max-w-[35rem] touch:rounded-[1.75rem] touch:animate-float';

/**
 * A dialog over the current page. The backdrop fades in. On touch screens the
 * panel rises as a floating sheet; with a mouse it rises from the bottom edge
 * below 640 px and grows slightly into place in the middle from 640 px up. A
 * dialog that only shows something has a close button at its top right
 * instead of a row of actions. A touch-only dialog stands in for something a
 * mouse does in place on the page.
 */
export const dialog = ({ iconName = '', title, body = '', actions = '', wide = false, closable = false, touchOnly = false }) => `
<div class="fixed inset-0 z-20 flex items-end justify-center p-0 ${SHEET_FRAME} mouse:sm:items-center mouse:sm:p-6${touchOnly ? ' mouse:hidden' : ''}">
  <div class="absolute inset-0 animate-fade bg-ink/45"></div>
  <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="relative w-full ${wide ? 'max-w-lg' : 'max-w-sm'} ${SHEET_PANEL} animate-sheet rounded-t-[1.75rem] bg-surface p-6 shadow-pop mouse:sm:animate-pop mouse:sm:rounded-[1.75rem]">
    <div class="flex items-center gap-3${closable ? ' pr-10' : ''}">${iconName ? icon(iconName, 'size-11') : ''}<h2 id="dialog-title" class="text-xl font-black">${title}</h2></div>
    ${closable ? `<span class="absolute top-3.5 right-3.5">${btnIcon(CLOSE, '关闭')}</span>` : ''}
    ${body}
    ${actions ? `<div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">${actions}</div>` : ''}
  </div>
</div>`;

/**
 * Editing a name on a touch screen: a sheet with the text box, prefilled with
 * the current value, and 取消 and 保存. With a mouse the name is edited in
 * place instead.
 */
export const editSheet = ({ title, value, label, error = '' }) =>
  dialog({
    title,
    touchOnly: true,
    body: `<div class="mt-5">${textInput(value, label, error)}</div>`,
    actions: `${btnSecondary('取消')}${btnPrimary('保存')}`,
  });

/**
 * A menu rising from the bottom over a dimmed page, at most 560 px wide and
 * centred; on touch screens it floats like every sheet, with even padding all
 * round. The menu's own border and shadow give way to the sheet's.
 */
export const menuSheet = (menu, extra = '') => `
<div class="fixed inset-0 z-20 flex items-end justify-center ${SHEET_FRAME} ${extra}">
  <div class="absolute inset-0 animate-fade bg-ink/45"></div>
  <div class="relative w-full max-w-[35rem] ${SHEET_PANEL} animate-sheet rounded-t-[1.75rem] bg-surface p-2 pb-6 touch:pb-2 [&>div]:w-full [&>div]:border-0 [&>div]:shadow-none">${menu}</div>
</div>`;

/**
 * A toast at the top of the screen. It slides down in, stays (3 s for news,
 * 5 s for problems) and slides up out by itself; its × closes it sooner.
 */
export const toast = (iconName, text, tone) => {
  const tones = { ok: 'bg-primary text-white animate-toast', bad: 'bg-rose-ink text-white animate-toast-long' };
  return `
<div role="status" class="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-pop ${tones[tone]}">
  ${icon(iconName, 'size-8')}<span class="flex-1 text-base font-bold">${text}</span>
  <button type="button" aria-label="关闭" class="-my-1.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white ${press}">${CLOSE}</button>
</div>`;
};
