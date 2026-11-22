import {
  ADMIN,
  CHILDREN,
  DEVICE,
  MORE,
  QR,
  appShell,
  avatar,
  btnDanger,
  btnIcon,
  btnPrimary,
  btnSecondary,
  btnTool,
  card,
  checkbox,
  dialog,
  formField,
  icon,
  menuSheet,
  page,
  qrSvg,
} from './ui.mjs';

// The 孩子 page of a family: every parent of the family adds children here,
// shows a child's login QR code and looks after the child's account.
const FAMILY = '林悦的家';
const TITLE = '孩子 - 好奇星球';
const [XIAOMING] = CHILDREN;
const LOGIN_LINK = 'https://thinklet-web.vercel.app/child/qr/EXAMPLE-TOKEN';
const ACCOUNT_HELP = '孩子登录时输入，只能用小写字母和数字';

/** The devices where 小明 ticked 在这台设备上记住我, most recently remembered last. */
const DEVICES = [
  { name: 'iPad · Safari', remembered: '11月18日', lastLogin: '11月22日 09:12' },
  { name: 'Android 手机 · Chrome', remembered: '11月20日', lastLogin: '11月21日 19:40' },
];

const ACTIONS = [
  { label: '改昵称和账号', icon: 'consent' },
  { label: '记住的设备', icon: 'hourglass' },
  { label: '重设密码', icon: 'key' },
  { label: '删除', icon: 'door', danger: true },
];

// A child's actions drop down from the row's button with a mouse; on touch
// screens they rise in a sheet headed by the child, as the row is out of reach.
const dropMenu = `
<div role="menu" class="absolute top-[calc(50%+1.5rem)] right-0 z-10 hidden w-52 origin-top-right animate-drop rounded-2xl border border-line bg-surface p-1.5 shadow-pop mouse:block">
  ${ACTIONS.map(
    (a) =>
      `<a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold hover:bg-canvas ${a.danger ? 'text-rose-ink' : ''}">${icon(a.icon, 'size-6')}${a.label}</a>`,
  ).join('')}
</div>`;

const childMenuSheet = (child) =>
  menuSheet(
    `<div role="menu" aria-label="${child.name}的操作" class="rounded-3xl bg-surface p-2">
       <div class="flex items-center gap-3 px-3 py-3">${avatar(child.name, child.color, 'size-10 text-base')}<p class="font-bold">${child.name}</p></div>
       <div class="my-1 border-t border-line"></div>
       ${ACTIONS.map(
         (a) =>
           `<a href="#" role="menuitem" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-bold hover:bg-canvas ${a.danger ? 'text-rose-ink' : ''}">${icon(a.icon, 'size-7')}${a.label}</a>`,
       ).join('')}
     </div>`,
    'mouse:hidden',
  );

// Each row is styled like a member row on the family page; the QR button
// uses the same line icon as the family code's.
const childRow = (child, menuOpen = false) => `
<li class="relative flex items-center gap-3 py-3 first:pt-0 last:pb-0">
  ${avatar(child.name, child.color, 'size-11 text-base')}
  <div class="min-w-0 flex-1">
    <p class="font-bold">${child.name}</p>
    <p class="truncate text-sm text-ink-soft">账号 ${child.account}</p>
  </div>
  ${btnTool(QR, '显示登录二维码')}
  ${btnIcon(MORE, '更多操作', menuOpen ? 'bg-canvas' : '')}
  ${menuOpen ? dropMenu : ''}
</li>`;

const addButton = (extra = '') => btnPrimary(`${icon('child', 'size-6')}添加孩子`, extra);

const listCard = (menuOpen) =>
  card(`<ul class="divide-y divide-line">${CHILDREN.map((child, i) => childRow(child, menuOpen && i === 0)).join('')}</ul>`);

const emptyCard = card(`
  <div class="flex flex-col items-center gap-2 py-8 text-center">
    ${icon('seedling', 'size-16')}
    <h2 class="mt-2 text-lg font-black">还没有孩子</h2>
    <p class="text-sm text-ink-soft">添加孩子后，孩子就能用自己的账号登录。</p>
    <div class="mt-4">${addButton()}</div>
  </div>`);

// With no children yet, the empty card carries the one way forward, so the
// button under the title is left out.
const childrenBody = ({ empty = false, menuOpen = false } = {}) => `
<div class="stagger mx-auto flex w-full max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <p class="text-sm font-bold text-ink-muted">${FAMILY}</p>
    <h1 class="text-3xl font-black">孩子</h1>
  </header>
  ${empty ? emptyCard : `<div>${addButton('w-full sm:w-auto')}</div>${listCard(menuOpen)}`}
</div>`;

const childrenPage = (options = {}, overlay = '') =>
  appShell({
    active: 'children',
    parent: ADMIN,
    overlay: options.menuOpen ? childMenuSheet(XIAOMING) : overlay,
    content: childrenBody(options),
  });

/**
 * Adding or changing a child: the nickname and the account, and when adding,
 * the guardian's consent. Pressing the button with mistakes marks every field
 * that has one.
 */
const childForm = ({ name = '', account = '', consent = false, errors = {} }) => `
<div class="mt-6 flex flex-col gap-5">
  ${formField({ id: 'child-name', label: '昵称', value: name, error: errors.name, focused: !Object.keys(errors).length })}
  ${formField({ id: 'child-account', label: '账号', value: account, helper: ACCOUNT_HELP, error: errors.account })}
  ${consent ? checkbox('我是这个孩子的监护人，同意好奇星球处理孩子的昵称、账号和登录记录', { error: errors.consent }) : ''}
</div>`;

const addDialog = (errors = {}) =>
  dialog({
    iconName: 'child',
    title: '添加孩子',
    wide: true,
    body: childForm({ account: errors.account ? 'xiaoming' : '', consent: true, errors }),
    actions: `${btnSecondary('取消')}${btnPrimary('添加')}`,
  });

const editDialog = dialog({
  iconName: 'consent',
  title: `修改${XIAOMING.name}`,
  wide: true,
  body: childForm({ name: XIAOMING.name, account: XIAOMING.account }),
  actions: `${btnSecondary('取消')}${btnPrimary('保存')}`,
});

const BIG_CHECK = `<svg class="size-14" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3L15 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const qrFrame = (content) => `<div class="relative rounded-card border border-line p-2">${content}</div>`;

/**
 * The child's login link as a QR code, valid for 10 minutes with the time
 * left counting down under it. Once it has run out the code fades under the
 * word 已失效 and can be made again; once the child has signed in with it,
 * a check mark takes its place.
 */
const qrBody = {
  live: `
<div class="mt-5 flex flex-col items-center gap-1 text-center">
  ${qrFrame(qrSvg(LOGIN_LINK, `${XIAOMING.name}的登录二维码`))}
  <p class="mt-3 text-base font-bold">10 分钟内有效，还剩 <span class="tabular-nums">9:41</span></p>
  <p class="text-sm text-ink-soft">用手机或平板的相机扫一扫</p>
</div>`,
  expired: `
<div class="mt-5 flex flex-col items-center text-center">
  ${qrFrame(`<div aria-hidden="true" class="opacity-15 grayscale">${qrSvg(LOGIN_LINK, '')}</div>
    <span class="absolute inset-0 flex items-center justify-center"><span class="rounded-full bg-surface px-5 py-2 text-lg font-black text-ink shadow-pop ring-1 ring-line-strong">已失效</span></span>`)}
  ${btnPrimary('重新生成', 'mt-5 w-full')}
</div>`,
  done: `
<div class="mt-6 flex flex-col items-center gap-4 text-center">
  <span class="flex size-28 animate-pop items-center justify-center rounded-full bg-mint text-mint-ink">${BIG_CHECK}</span>
  <p class="text-xl font-black">${XIAOMING.name}已登录</p>
  ${btnPrimary('完成', 'mt-2 w-full')}
</div>`,
};

const qrDialog = (state) =>
  dialog({
    title: `让${XIAOMING.name}扫码登录`,
    closable: state !== 'done',
    body: qrBody[state],
  });

// Dates of this year read like 11月21日 09:12, in the family's time zone; each
// half of the second line stays whole when it wraps.
const deviceRow = (d) => `
<li class="flex items-center gap-3 py-3">
  <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-canvas text-primary">${DEVICE}</span>
  <div class="min-w-0 flex-1">
    <p class="font-bold">${d.name}</p>
    <p class="text-sm text-ink-soft"><span class="whitespace-nowrap">记住于 ${d.remembered}</span> · <span class="whitespace-nowrap">最近登录 ${d.lastLogin}</span></p>
  </div>
  ${btnSecondary('撤销', 'min-h-11 px-4 text-sm')}
</li>`;

const devicesDialog = (devices) =>
  dialog({
    title: `${XIAOMING.name}记住的设备`,
    closable: true,
    wide: true,
    body: devices.length
      ? `<ul class="mt-4 divide-y divide-line">${devices.map(deviceRow).join('')}</ul>
         <div class="mt-4 flex justify-end">${btnSecondary('全部撤销', 'min-h-11 w-full px-5 text-sm sm:w-auto')}</div>`
      : `<div class="mt-4 flex flex-col items-center gap-2 py-6 text-center">
           ${icon('hourglass', 'size-14')}
           <p class="font-bold">还没有记住的设备</p>
           <p class="text-sm text-ink-soft">孩子登录时勾选「在这台设备上记住我」，这台设备就会出现在这里。</p>
         </div>`,
  });

const confirmDialog = ({ iconName, title, text, action, danger = false }) =>
  dialog({
    iconName,
    title,
    body: `<p class="mt-3 text-base text-ink-soft">${text}</p>`,
    actions: `${btnSecondary('取消')}${danger ? btnDanger(action) : btnPrimary(action)}`,
  });

const overList = (name, overlay) => ({ name, viewportOnly: true, html: page(TITLE, childrenPage({}, overlay)) });

export default [
  { name: 'children', html: page(TITLE, childrenPage()) },
  { name: 'children-empty', html: page(TITLE, childrenPage({ empty: true })) },
  { name: 'children-menu', viewportOnly: 'touch', html: page(TITLE, childrenPage({ menuOpen: true })) },
  overList('child-add', addDialog()),
  overList('child-add-error', addDialog({ name: '请填昵称', account: '家里已经有孩子用这个账号了', consent: '请先同意' })),
  overList('child-edit', editDialog),
  overList('child-qr', qrDialog('live')),
  overList('child-qr-expired', qrDialog('expired')),
  overList('child-qr-done', qrDialog('done')),
  overList('child-devices', devicesDialog(DEVICES)),
  overList('child-devices-empty', devicesDialog([])),
  overList(
    'dialog-reset-password',
    confirmDialog({
      iconName: 'key',
      title: `重设${XIAOMING.name}的密码？`,
      text: `旧密码马上不能用，已经登录的设备会退出，记住的设备也会一起撤销。${XIAOMING.name}下次扫登录二维码时设新密码。`,
      action: '重设',
    }),
  ),
  overList(
    'dialog-delete-child',
    confirmDialog({
      iconName: 'door',
      title: `删除${XIAOMING.name}？`,
      text: `${XIAOMING.name}的账号、记住的设备和同意记录都会删掉，不能恢复。`,
      action: '删除',
      danger: true,
    }),
  ),
  // Revoking every device is asked from the devices dialog, so the question
  // stands over it and dims it.
  overList(
    'dialog-revoke-all',
    `${devicesDialog(DEVICES)}${confirmDialog({
      iconName: 'hourglass',
      title: `撤销${XIAOMING.name}的全部设备？`,
      text: '这些设备上点头像不能再直接登录，要重新输入密码。',
      action: '全部撤销',
    })}`,
  ),
];
