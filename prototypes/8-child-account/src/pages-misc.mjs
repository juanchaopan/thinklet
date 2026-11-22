import { homeSignedInBody, homeVisitorBody } from './pages-home.mjs';
import {
  ADMIN,
  CHECK,
  appShell,
  btnPrimary,
  btnSecondary,
  card,
  chip,
  dialog,
  icon,
  menuItem,
  menuSheet,
  page,
  publicShell,
  toast,
  userMenu,
} from './ui.mjs';

// The family switcher lists the parent's families and creating one; joining
// another family lives in the parent's own menu.
const familyMenu = `
<div role="menu" aria-label="切换家庭" class="w-72 rounded-3xl border border-line bg-surface p-2 shadow-pop">
  ${menuItem(`${icon('family', 'size-7')}<span class="flex-1 font-bold">林悦的家</span>${chip('管理员', 'sun')}<span class="text-violet">${CHECK}</span>`, 'bg-tint')}
  ${menuItem(`${icon('family', 'size-7')}<span class="flex-1 font-bold">外婆家</span>`)}
  <div class="my-2 border-t border-line"></div>
  ${menuItem(`${icon('seedling', 'size-7')}<span class="font-bold">创建家庭</span>`)}
</div>`;

// Menus open over the current page. With a mouse on a wide screen they drop
// down from their buttons; on touch screens, and below 1024 px where the
// button sits in the top bar, they slide up from the bottom over a dimmed page.
const openMenu = (menu, wideClass, origin) =>
  appShell({
    active: 'home',
    content: homeSignedInBody,
    overlay: `
<div class="fixed inset-0 z-20 hidden mouse:lg:block">
  <div class="absolute ${wideClass} ${origin} animate-drop">${menu}</div>
</div>
${menuSheet(menu, 'mouse:lg:hidden')}`,
  });

// The parent's menu opens from the avatar in the top bar below 1024 px. From
// 1024 px its entries stand in the sidebar instead, so that capture shows the
// sidebar group.
const parentMenuOpen = appShell({
  active: 'home',
  unseen: true,
  content: homeSignedInBody,
  overlay: menuSheet(userMenu(ADMIN, true), 'lg:hidden'),
});

/** A whole page that could not be shown, inside the usual frame, always the same width. */
const problem = ({ iconName, title, text, action, code = '' }) => `
<div class="mx-auto w-full max-w-md animate-rise py-10">
  ${card(`
    <div class="flex flex-col items-center text-center">
      ${icon(iconName, 'size-16')}
      <h1 class="mt-4 text-2xl font-black">${title}</h1>
      <p class="mt-2 text-base text-ink-soft">${text}</p>
      ${code ? `<p class="mt-3 font-mono text-sm text-ink-muted">错误编号 ${code}</p>` : ''}
      <div class="mt-6 w-full">${btnPrimary(action, 'w-full')}</div>
    </div>
  `)}
</div>`;

// Signing in failed on the way back from Authing: the product home page stays
// behind, and a dialog says so.
const loginFailed = publicShell(
  homeVisitorBody,
  dialog({
    iconName: 'wrench',
    title: '登录没有成功',
    body: '<p class="mt-3 text-base text-ink-soft">请再试一次。</p>',
    actions: `${btnSecondary('关闭')}${btnPrimary('再试一次')}`,
  }),
);

const notFound = appShell({
  active: 'family',
  content: problem({ iconName: 'search', title: '找不到这个家庭', text: '它不存在，或者你已经不是成员。', action: '回到我的家庭' }),
});

const serverError = appShell({
  active: 'family',
  content: problem({ iconName: 'wrench', title: '页面没能打开', text: '出了点问题，请稍后再试。', action: '重试', code: 'a1f3-92c0' }),
});

export default [
  { name: 'menu-family', viewportOnly: true, html: page('好奇星球', openMenu(familyMenu, 'top-36 left-4', 'origin-top-left')) },
  { name: 'menu-family-opening', viewportOnly: true, frames: [0, 100, 300], html: page('好奇星球', openMenu(familyMenu, 'top-36 left-4', 'origin-top-left')) },
  { name: 'menu-user', viewportOnly: 'touch', html: page('好奇星球', parentMenuOpen) },
  { name: 'error-login', viewportOnly: true, html: page('好奇星球', loginFailed) },
  { name: 'error-not-found', html: page('找不到这个家庭 - 好奇星球', notFound) },
  { name: 'error-server', html: page('页面没能打开 - 好奇星球', serverError) },
  {
    name: 'toast-offline',
    viewportOnly: true,
    frames: [2500],
    html: page('好奇星球', appShell({ active: 'home', content: homeSignedInBody, overlay: toast('wrench', '网络断开了，请稍后再试', 'bad') })),
  },
];
