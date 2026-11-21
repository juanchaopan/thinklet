// Shared building blocks for the static prototype pages.
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

export const PENCIL = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.8 4.2 15.8 7.2M4 16l.8-3.6L13.6 3.6a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2l-8.8 8.8L4 16Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>`;
export const COPY = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M13 4.5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
export const MORE = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;
export const CHECK = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3L15 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const SEARCH = `<svg class="size-5" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

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

export const chevron = (cls = 'size-4 text-ink-muted') =>
  `<svg class="${cls} shrink-0" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A select-like button showing the chosen time zone. */
export const timezoneField = (value = 'Asia/Shanghai（UTC+08:00）', focused = false) => `
<button type="button" class="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border bg-surface px-4 text-left text-base ${
  focused ? 'border-violet ring-2 ring-violet/20' : 'border-line-strong'
}">
  <span>${value}</span>${chevron()}
</button>`;

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
export const MEMBER = { name: '周子航', color: 1, email: 'zihang.zhou@example.com' };

export const userMenuButton = (parent) => `
<button type="button" class="flex min-h-11 items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-surface/70">
  ${avatar(parent.name, parent.color)}
  <span class="hidden text-sm font-bold sm:inline">${parent.name}</span>
  ${chevron()}
</button>`;

/** Top bar of the pages a visitor sees before signing in: the full logo, shown large. */
export const publicShell = (content, overlay = '') => `
<div class="flex min-h-screen flex-col">
  <header class="flex h-24 items-center px-5 sm:px-8">${logoImage(72)}</header>
  <main class="flex flex-1 flex-col">${content}</main>
  ${overlay}
</div>`;

/** A page for a signed-in parent who has no family yet: the full logo and the user menu, no menus. */
export const bareShell = (content, overlay = '', parent = ADMIN) => `
<div class="flex min-h-screen flex-col">
  <header class="flex h-24 items-center px-4 sm:px-8">${logoImage(64)}<span class="ml-auto">${userMenuButton(parent)}</span></header>
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
 * The menu entries. "新成员" is shown to the family's admin only, with a red
 * count while requests wait.
 */
const navItems = (admin, pending) => [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'family', label: '家庭管理', icon: 'settings' },
  ...(admin ? [{ key: 'members', label: '新成员', icon: 'letter', count: pending }] : []),
];

/**
 * Signed-in layout. Wide screens get a left sidebar and the user menu at the
 * top right; narrow screens get a top bar and a bottom tab bar. Both show the
 * logo mark, as the full logo's name is not legible at navigation size.
 */
export const appShell = ({ active, content, family = '林悦的家', parent = ADMIN, admin = true, pending = 2, overlay = '' }) => {
  const items = navItems(admin, pending);
  return `
<div class="min-h-screen lg:flex">
  <aside class="hidden w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface/80 px-4 py-5 backdrop-blur lg:flex">
    <div class="px-2">${logoMark(48)}</div>
    ${familySwitcher(family)}
    <nav aria-label="主菜单" class="flex flex-col gap-1">
      ${items
        .map(
          (item) => `<a href="#" class="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-bold transition-colors duration-150 ${
            item.key === active ? 'bg-tint text-ink' : 'text-ink-soft hover:bg-canvas'
          }"${item.key === active ? ' aria-current="page"' : ''}>${icon(item.icon, 'size-8')}<span class="flex-1">${item.label}</span>${
            item.count ? badge(item.count) : ''
          }</a>`,
        )
        .join('')}
    </nav>
  </aside>
  <div class="flex min-w-0 flex-1 flex-col">
    <header class="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6 lg:justify-end lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none">
      <span class="lg:hidden">${logoMark(38)}</span>
      <span class="ml-auto lg:hidden">${familySwitcher(family, true)}</span>
      ${userMenuButton(parent)}
    </header>
    <main class="flex-1 px-4 pt-4 pb-28 sm:px-6 lg:px-10 lg:pb-12">${content}</main>
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
 * A dialog over the current page. The backdrop fades in; the panel rises from
 * the bottom edge on narrow screens and grows slightly into place on wide ones.
 */
export const dialog = ({ iconName = '', title, body = '', actions, wide = false }) => `
<div class="fixed inset-0 z-20 flex items-end justify-center p-0 sm:items-center sm:p-6">
  <div class="absolute inset-0 animate-fade bg-ink/45"></div>
  <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="relative w-full ${wide ? 'max-w-lg' : 'max-w-sm'} animate-sheet rounded-t-[1.75rem] bg-surface p-6 shadow-pop sm:animate-pop sm:rounded-[1.75rem]">
    <div class="flex items-center gap-3">${iconName ? icon(iconName, 'size-11') : ''}<h2 id="dialog-title" class="text-xl font-black">${title}</h2></div>
    ${body}
    <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">${actions}</div>
  </div>
</div>`;

/**
 * A toast at the top of the screen. It slides down in, stays (3 s for news,
 * 5 s for problems) and slides up out by itself.
 */
export const toast = (iconName, text, tone) => {
  const tones = { ok: 'bg-primary text-white animate-toast', bad: 'bg-rose-ink text-white animate-toast-long' };
  return `
<div role="status" class="fixed inset-x-4 top-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-pop ${tones[tone]}">
  ${icon(iconName, 'size-8')}<span class="text-base font-bold">${text}</span>
</div>`;
};
