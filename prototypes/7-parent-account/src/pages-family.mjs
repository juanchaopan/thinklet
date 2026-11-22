import QRCode from 'qrcode';
import {
  ADMIN,
  CHECK,
  COPY,
  MEMBER,
  MORE,
  PENCIL,
  QR,
  SEARCH,
  SHARE,
  SHEET_FRAME,
  SHEET_PANEL,
  appShell,
  avatar,
  btnDanger,
  btnIcon,
  btnPrimary,
  btnSecondary,
  btnText,
  btnTool,
  card,
  chip,
  dialog,
  editRow,
  editSheet,
  icon,
  menuSheet,
  page,
  textInput,
  timezoneField,
  toast,
} from './ui.mjs';

// The family page shows the family as it is. Admin and member see the same
// layout; the admin also sees the pencil buttons and the actions.
const OTHER = { name: '林建国', color: 2, email: 'jianguo.lin@example.com' };
const FAMILY = '林悦的家';
const CODE = '7KQ4MZ';
const INVITE_LINK = `https://thinklet-web.vercel.app/join/${CODE}`;
const TITLE = '家庭管理 - 好奇星球';
const MEMBERS_TITLE = '新成员 - 好奇星球';

const titleView = (admin, extra = '') => `<div class="flex items-center gap-1 ${extra}">
         <h1 class="text-3xl font-black">${FAMILY}</h1>
         ${admin ? btnIcon(PENCIL, '改家庭名称') : ''}
       </div>`;

// While the name is being edited, a touch screen keeps showing the name and
// edits it in a sheet; with a mouse the title gives way to the edit row.
const header = ({ admin, editing }) =>
  editing === 'name'
    ? `${titleView(admin, 'mouse:hidden')}<div class="hidden flex-col gap-2 mouse:flex"><p class="text-sm font-bold text-ink-muted">家庭名称</p>${editRow(textInput(FAMILY, '家庭名称'))}</div>`
    : titleView(admin);

const row = (iconName, label, content) => `
<div class="flex gap-4 py-5 first:pt-0 last:pb-0">
  ${icon(iconName, 'size-9 mt-1')}
  <div class="min-w-0 flex-1">
    <p class="text-sm font-bold text-ink-muted">${label}</p>
    <div class="mt-1">${content}</div>
  </div>
</div>`;

const timezoneRow = ({ admin, editing, timezoneHint }) =>
  row(
    'globe',
    '时区',
    editing === 'timezone'
      ? editRow(timezoneField('Asia/Shanghai（UTC+08:00）', true))
      : `<div class="flex items-center gap-1"><p class="text-base font-bold">Asia/Shanghai（UTC+08:00）</p>${admin ? btnIcon(PENCIL, '改时区') : ''}</div>
         ${
           admin && timezoneHint
             ? `<div class="mt-2 flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sun px-4 py-2.5 text-sm text-sun-ink">
                  <span class="flex-1 basis-40">当前位置：America/Toronto（UTC−05:00）</span>
                  <button type="button" class="min-h-11 rounded-full bg-surface px-4 font-bold text-ink shadow-card">改成这个</button>
                </div>`
             : ''
         }`,
  );

// Every parent can pass the code on: copy it, share the invitation, or show
// the invitation link as a QR code. Only the admin can replace the code.
const codeRow = (admin) =>
  row(
    'key',
    '家庭码',
    `<div class="flex flex-wrap items-center gap-2">
       <p class="font-mono text-3xl font-black tracking-[0.25em]" aria-label="家庭码 ${[...CODE].join(' ')}">${CODE}</p>
       <div class="flex gap-2">${btnTool(COPY, '复制家庭码')}${btnTool(SHARE, '分享邀请')}${btnTool(QR, '显示二维码')}</div>
       ${admin ? btnText('更换家庭码', 'border border-line') : ''}
     </div>`,
  );

// A member's actions drop down from the row's button with a mouse; on touch
// screens they rise in a sheet headed by the member, as the row is out of reach.
const memberRow = (person, { isAdmin, you, viewerIsAdmin, menuOpen = false }) => `
<li class="relative flex items-center gap-3 py-3">
  ${avatar(person.name, person.color, 'size-11 text-base')}
  <div class="min-w-0 flex-1">
    <p class="flex flex-wrap items-center gap-2 font-bold">${person.name}${you ? '<span class="text-sm font-normal text-ink-muted">（你）</span>' : ''}${isAdmin ? chip(`${icon('crown', 'size-4')}管理员`, 'sun') : ''}</p>
    <p class="truncate text-sm text-ink-soft">${person.email ?? '—'}</p>
  </div>
  ${viewerIsAdmin && !you ? btnIcon(MORE, `${person.name}的操作`, menuOpen ? 'bg-canvas' : '') : ''}
  ${
    menuOpen
      ? `<div role="menu" class="absolute top-[calc(50%+1.5rem)] right-0 z-10 hidden w-44 origin-top-right animate-drop rounded-2xl border border-line bg-surface p-1.5 shadow-pop mouse:block">
           <a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold hover:bg-canvas">${icon('crown', 'size-6')}设为管理员</a>
           <a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold text-rose-ink hover:bg-canvas">${icon('door', 'size-6')}移出家庭</a>
         </div>`
      : ''
  }
</li>`;

const memberMenuSheet = (person) =>
  menuSheet(
    `<div role="menu" aria-label="${person.name}的操作" class="rounded-3xl bg-surface p-2">
       <div class="flex items-center gap-3 px-3 py-3">${avatar(person.name, person.color, 'size-10 text-base')}<p class="font-bold">${person.name}</p></div>
       <div class="my-1 border-t border-line"></div>
       <a href="#" role="menuitem" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-bold hover:bg-canvas">${icon('crown', 'size-7')}设为管理员</a>
       <a href="#" role="menuitem" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-bold text-rose-ink hover:bg-canvas">${icon('door', 'size-7')}移出家庭</a>
     </div>`,
    'mouse:hidden',
  );

const membersCard = (viewerIsAdmin, menuOpen) =>
  card(`
  <h2 class="text-xl font-black">家庭成员</h2>
  <p class="mt-4 text-sm font-bold text-ink-muted">家长 · 3</p>
  <ul class="mt-1 divide-y divide-line">
    ${memberRow(ADMIN, { isAdmin: true, you: viewerIsAdmin, viewerIsAdmin })}
    ${memberRow(MEMBER, { isAdmin: false, you: !viewerIsAdmin, viewerIsAdmin, menuOpen })}
    ${memberRow(OTHER, { isAdmin: false, you: false, viewerIsAdmin })}
  </ul>`);

const leaveLine = (admin) =>
  admin
    ? `<div class="flex flex-wrap items-center justify-end gap-2 text-sm text-ink-muted"><span>先把管理员设给别人才能离开</span>${btnText('离开家庭', 'cursor-not-allowed opacity-40')}</div>`
    : `<div class="flex justify-end">${btnText('离开家庭', 'text-rose-ink')}</div>`;

// The family code, used most, comes first; the time zone follows with its
// hint directly under it.
export const familyBody = ({ admin, editing = '', timezoneHint = false, menuOpen = false }) => `
<div class="stagger mx-auto flex max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <p class="text-sm font-bold text-ink-muted">家庭管理</p>
    ${header({ admin, editing })}
  </header>
  ${card(`<div class="divide-y divide-line">${codeRow(admin)}${timezoneRow({ admin, editing, timezoneHint })}</div>`)}
  ${membersCard(admin, menuOpen)}
  ${leaveLine(admin)}
</div>`;

const familyPage = (options, overlay = '') =>
  appShell({
    active: 'family',
    parent: options.admin ? ADMIN : MEMBER,
    admin: options.admin,
    overlay: options.menuOpen ? memberMenuSheet(MEMBER) : overlay,
    content: familyBody(options),
  });

// Dates of this year read like 11月21日 09:12, in the family's time zone.
const pendingRow = (name, email, color, when) => `
<li class="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0">
  ${avatar(name, color, 'size-11 text-base')}
  <div class="min-w-0 flex-1">
    <p class="font-bold">${name}</p>
    <p class="truncate text-sm text-ink-soft">${email} · ${when}</p>
  </div>
  <div class="flex w-full gap-2 sm:w-auto">
    ${btnText('拒绝', 'flex-1 border border-line sm:flex-none')}
    ${btnPrimary(`${CHECK}同意`, 'min-h-11 flex-1 px-5 text-sm sm:flex-none')}
  </div>
</li>`;

// A handled request stays in the list until the admin presses 知道了.
const historyRow = (name, email, color, result, when) => {
  const results = { approved: ['已同意', 'mint'], rejected: ['已拒绝', 'rose'], expired: ['已失效', 'gray'] };
  const [label, tone] = results[result];
  return `
<li class="flex items-center gap-3 py-3">
  ${avatar(name, color, 'size-10 text-sm opacity-80')}
  <div class="min-w-0 flex-1">
    <p class="flex flex-wrap items-center gap-2 font-bold">${name}${chip(label, tone)}</p>
    <p class="truncate text-sm text-ink-soft">${email} · ${when}</p>
  </div>
  ${btnSecondary('知道了', 'min-h-11 px-4 text-sm')}
</li>`;
};

const membersPage = (empty, overlay = '') =>
  appShell({
    active: 'members',
    pending: empty ? 0 : 2,
    overlay,
    content: `
<div class="stagger mx-auto flex max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <p class="text-sm font-bold text-ink-muted">${FAMILY}</p>
    <h1 class="text-3xl font-black">新成员</h1>
  </header>
  ${card(`
    <h2 class="text-lg font-black">等你处理</h2>
    ${
      empty
        ? `<div class="flex flex-col items-center gap-2 py-6 text-center">${icon('letter', 'size-14')}<p class="font-bold text-ink-soft">没有新的申请</p></div>`
        : `<ul class="mt-4 divide-y divide-line">
            ${pendingRow('陈晓', 'chenxiao@example.com', 3, '11月21日 09:12')}
            ${pendingRow('王一凡', 'yifan.wang@example.com', 4, '11月20日 20:40')}
          </ul>`
    }
  `)}
  ${
    empty
      ? ''
      : card(`
    <h2 class="text-lg font-black">处理过的</h2>
    <ul class="mt-2 divide-y divide-line">
      ${historyRow('林建国', 'jianguo.lin@example.com', 2, 'approved', '11月18日')}
      ${historyRow('李想', 'lixiang@example.com', 4, 'rejected', '11月10日')}
      ${historyRow('赵琳', 'zhaolin@example.com', 3, 'expired', '11月6日')}
    </ul>
  `)
  }
</div>`,
  });

// Every IANA time zone with its UTC offset on the prototype's date, sorted by
// offset and then by name, as the picker lists them.
const ON = new Date('2026-11-21T12:00:00Z');
const MINUS = '−';

const offsetOf = (zone) => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(ON)
    .find((part) => part.type === 'timeZoneName').value;
  return name === 'GMT' ? '+00:00' : name.slice(3);
};

const ZONES = Intl.supportedValuesOf('timeZone')
  .map((zone) => {
    const offset = offsetOf(zone);
    const sign = offset[0] === '-' ? -1 : 1;
    return {
      zone,
      label: `UTC${offset.replace('-', MINUS)}`,
      minutes: sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))),
    };
  })
  .sort((a, b) => a.minutes - b.minutes || a.zone.localeCompare(b.zone, 'en'));

/**
 * The zones whose IANA name contains the query, ignoring case, or whose
 * offset text does; a typed hyphen also matches the minus sign shown.
 */
const searchZones = (query) => {
  const q = query.trim().toLowerCase().replaceAll('-', MINUS);
  return ZONES.filter((z) => z.zone.toLowerCase().includes(q) || z.label.toLowerCase().includes(q));
};

// The time zone picker: a search box over the full list. Like every dialog it
// is a floating sheet on touch screens and sits in the middle with a mouse
// from 640 px up. The first result is the highlighted one.
const timezonePicker = (query) => `
<div class="fixed inset-0 z-20 flex items-end justify-center ${SHEET_FRAME} mouse:sm:items-center mouse:sm:p-6">
  <div class="absolute inset-0 animate-fade bg-ink/45"></div>
  <div role="dialog" aria-modal="true" aria-labelledby="tz-title" class="relative flex max-h-[80vh] w-full max-w-md ${SHEET_PANEL} animate-sheet flex-col rounded-t-[1.75rem] bg-surface p-5 shadow-pop mouse:sm:animate-pop mouse:sm:rounded-[1.75rem]">
    <h2 id="tz-title" class="text-xl font-black">选择时区</h2>
    <label class="mt-4 flex min-h-12 items-center gap-2 rounded-2xl border border-violet px-4 ring-2 ring-violet/20">
      <span class="text-ink-muted">${SEARCH}</span><input type="text" value="${query}" aria-label="搜索时区" class="min-w-0 flex-1 bg-transparent text-base outline-none" />
    </label>
    <ul class="mt-3 -mx-2 overflow-auto" role="listbox">
      ${searchZones(query)
        .map(
          ({ zone, label }, i) => `<li role="option" aria-selected="${i === 0}" class="flex min-h-12 items-center rounded-xl px-3 ${
            i === 0 ? 'bg-tint font-bold' : ''
          }">${zone}（${label}）</li>`,
        )
        .join('')}
    </ul>
  </div>
</div>`;

/**
 * The invitation link as a QR code, drawn module by module as SVG squares
 * with the standard quiet zone of four modules around it. Each dark run of a
 * row becomes one rectangle, so the drawing stays small.
 */
const qrSvg = (text, pixels = 6) => {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const quiet = 4;
  const span = modules.size + quiet * 2;
  const rects = [];
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (!modules.get(y, x)) continue;
      let end = x;
      while (end + 1 < modules.size && modules.get(y, end + 1)) end++;
      rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="${end - x + 1}" height="1"/>`);
      x = end;
    }
  }
  return `<svg role="img" aria-label="邀请链接的二维码" width="${span * pixels}" height="${span * pixels}" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" class="block"><rect width="${span}" height="${span}" fill="#ffffff"/><g fill="#161a2b">${rects.join('')}</g></svg>`;
};

const qrDialog = dialog({
  title: `扫码加入「${FAMILY}」`,
  closable: true,
  body: `<div class="mt-5 flex flex-col items-center gap-4">
    <div class="rounded-card border border-line p-2">${qrSvg(INVITE_LINK)}</div>
    <p class="text-base text-ink-soft">也可以输入家庭码 <span class="font-mono text-lg font-black tracking-[0.25em] text-ink">${CODE}</span></p>
  </div>`,
});

const confirm = (name, admin, { iconName, title, text, action, danger = false }) => ({
  name,
  viewportOnly: true,
  html: page(
    TITLE,
    familyPage(
      { admin },
      dialog({
        iconName,
        title,
        body: `<p class="mt-3 text-base text-ink-soft">${text}</p>`,
        actions: `${btnSecondary('取消')}${danger ? btnDanger(action) : btnPrimary(action)}`,
      }),
    ),
  ),
});

export default [
  { name: 'family-admin', html: page(TITLE, familyPage({ admin: true })) },
  {
    name: 'family-admin-edit-name',
    viewportOnly: 'touch',
    html: page(TITLE, familyPage({ admin: true, editing: 'name' }, editSheet({ title: '改家庭名称', value: FAMILY, label: '家庭名称' }))),
  },
  { name: 'family-admin-edit-timezone', html: page(TITLE, familyPage({ admin: true, editing: 'timezone' })) },
  { name: 'family-admin-timezone-picker', viewportOnly: true, html: page(TITLE, familyPage({ admin: true, editing: 'timezone' }, timezonePicker('tor'))) },
  { name: 'family-admin-timezone-hint', html: page(TITLE, familyPage({ admin: true, timezoneHint: true })) },
  { name: 'family-admin-member-menu', viewportOnly: 'touch', html: page(TITLE, familyPage({ admin: true, menuOpen: true })) },
  { name: 'family-member', html: page(TITLE, familyPage({ admin: false })) },
  {
    name: 'family-saved',
    viewportOnly: true,
    frames: [0, 125, 250, 1500, 3325, 3400],
    html: page(TITLE, familyPage({ admin: true }, toast('party', '已保存', 'ok'))),
  },
  {
    name: 'toast-copied',
    viewportOnly: true,
    frames: [1500],
    html: page(TITLE, familyPage({ admin: true }, toast('key', '已复制', 'ok'))),
  },
  { name: 'dialog-qr', viewportOnly: true, html: page(TITLE, familyPage({ admin: true }, qrDialog)) },
  { name: 'new-members', html: page(MEMBERS_TITLE, membersPage(false)) },
  { name: 'new-members-empty', html: page(MEMBERS_TITLE, membersPage(true)) },
  // Approving failed on the server: the request stays in the list, the count
  // stays as it was, and the toast says so.
  {
    name: 'toast-action-error',
    viewportOnly: true,
    frames: [0, 125, 250, 2500, 5250, 5400],
    html: page(MEMBERS_TITLE, membersPage(false, toast('wrench', '出了点问题，请稍后再试', 'bad'))),
  },
  confirm('dialog-new-code', true, {
    iconName: 'key',
    title: '更换家庭码？',
    text: '旧码会失效，用旧码发的申请也会作废。',
    action: '更换',
    danger: true,
  }),
  confirm('dialog-make-admin', true, {
    iconName: 'crown',
    title: '让周子航当管理员？',
    text: '你将变成普通家长。',
    action: '确定',
  }),
  confirm('dialog-remove-parent', true, {
    iconName: 'door',
    title: '把周子航移出家庭？',
    text: '移出后，周子航就看不到这个家庭了。',
    action: '移出',
    danger: true,
  }),
  confirm('dialog-leave', false, {
    iconName: 'door',
    title: `离开「${FAMILY}」？`,
    text: '离开后要重新申请才能回来。',
    action: '离开',
    danger: true,
  }),
];
