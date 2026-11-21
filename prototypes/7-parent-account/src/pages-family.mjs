import {
  ADMIN,
  CHECK,
  COPY,
  MEMBER,
  MORE,
  PENCIL,
  SEARCH,
  appShell,
  avatar,
  btnDanger,
  btnIcon,
  btnPrimary,
  btnSecondary,
  btnText,
  card,
  chip,
  dialog,
  icon,
  page,
  timezoneField,
  toast,
} from './ui.mjs';

// The family page shows the family as it is. Admin and member see the same
// layout; the admin also sees the pencil buttons and the actions.
const OTHER = { name: '林建国', color: 2 };

const editRow = (input) => `
<div class="flex animate-fade flex-col gap-3 sm:flex-row sm:items-center">
  <div class="flex-1">${input}</div>
  <div class="flex gap-2">${btnText('取消', 'flex-1 border border-line sm:flex-none')}${btnPrimary('保存', 'min-h-11 flex-1 px-5 text-sm sm:flex-none')}</div>
</div>`;

const textInput = (value) =>
  `<input type="text" value="${value}" aria-label="家庭名称" class="block min-h-12 w-full rounded-2xl border border-violet bg-surface px-4 text-base outline-none ring-2 ring-violet/20" />`;

const header = ({ admin, editing }) =>
  editing === 'name'
    ? `<div class="flex flex-col gap-2"><p class="text-sm font-bold text-ink-muted">家庭名称</p>${editRow(textInput('林悦的家'))}</div>`
    : `<div class="flex items-center gap-1">
         <h1 class="text-3xl font-black">林悦的家</h1>
         ${admin ? btnIcon(PENCIL, '改家庭名称') : ''}
       </div>`;

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

const codeRow = (admin) =>
  row(
    'key',
    '家庭码',
    `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
       <p class="font-mono text-3xl font-black tracking-[0.25em]" aria-label="家庭码 7 K Q 4 M Z">7KQ4MZ</p>
       ${btnIcon(COPY, '复制家庭码')}
       ${btnText('复制邀请链接', 'border border-line')}
       ${admin ? btnText('更换家庭码', 'border border-line') : ''}
     </div>`,
  );

const memberRow = (person, { isAdmin, you, viewerIsAdmin, menuOpen = false }) => `
<li class="relative flex items-center gap-3 py-3">
  ${avatar(person.name, person.color, 'size-11 text-base')}
  <p class="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-bold">${person.name}${you ? '<span class="text-sm font-normal text-ink-muted">（你）</span>' : ''}${isAdmin ? chip(`${icon('crown', 'size-4')}管理员`, 'sun') : ''}</p>
  ${viewerIsAdmin && !you ? btnIcon(MORE, `${person.name}的操作`, menuOpen ? 'bg-canvas' : '') : ''}
  ${
    menuOpen
      ? `<div role="menu" class="absolute top-14 right-0 z-10 w-44 origin-top-right animate-drop rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
           <a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold hover:bg-canvas">${icon('crown', 'size-6')}设为管理员</a>
           <a href="#" role="menuitem" class="flex min-h-11 items-center gap-2 rounded-xl px-3 font-bold text-rose-ink hover:bg-canvas">${icon('door', 'size-6')}移出家庭</a>
         </div>`
      : ''
  }
</li>`;

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

export const familyBody = ({ admin, editing = '', timezoneHint = false, menuOpen = false }) => `
<div class="stagger mx-auto flex max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <p class="text-sm font-bold text-ink-muted">家庭管理</p>
    ${header({ admin, editing })}
  </header>
  ${card(`<div class="divide-y divide-line">${timezoneRow({ admin, editing, timezoneHint })}${codeRow(admin)}</div>`)}
  ${membersCard(admin, menuOpen)}
  ${leaveLine(admin)}
</div>`;

const familyPage = (options, overlay = '') =>
  appShell({
    active: 'family',
    parent: options.admin ? ADMIN : MEMBER,
    admin: options.admin,
    overlay,
    content: familyBody(options),
  });

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

const membersPage = (empty) =>
  appShell({
    active: 'members',
    pending: empty ? 0 : 2,
    content: `
<div class="stagger mx-auto flex max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <p class="text-sm font-bold text-ink-muted">林悦的家</p>
    <h1 class="text-3xl font-black">新成员</h1>
  </header>
  ${card(`
    <h2 class="text-lg font-black">等你处理</h2>
    ${
      empty
        ? `<div class="flex flex-col items-center gap-2 py-6 text-center">${icon('letter', 'size-14')}<p class="font-bold text-ink-soft">没有新的申请</p></div>`
        : `<ul class="mt-4 divide-y divide-line">
            ${pendingRow('陈晓', 'chenxiao@example.com', 3, '今天 09:12')}
            ${pendingRow('王一凡', 'yifan.wang@example.com', 4, '昨天 20:40')}
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

// The time zone picker: a search box over the full list of IANA time zones,
// each with its current UTC offset.
const timezonePicker = `
<div class="fixed inset-0 z-20 flex items-end justify-center sm:items-center sm:p-6">
  <div class="absolute inset-0 animate-fade bg-ink/45"></div>
  <div role="dialog" aria-modal="true" aria-labelledby="tz-title" class="relative flex max-h-[80vh] w-full max-w-md animate-sheet flex-col rounded-t-[1.75rem] bg-surface p-5 shadow-pop sm:animate-pop sm:rounded-[1.75rem]">
    <h2 id="tz-title" class="text-xl font-black">选择时区</h2>
    <label class="mt-4 flex min-h-12 items-center gap-2 rounded-2xl border border-violet px-4 ring-2 ring-violet/20">
      <span class="text-ink-muted">${SEARCH}</span><input type="text" value="tor" aria-label="搜索时区" class="min-w-0 flex-1 bg-transparent text-base outline-none" />
    </label>
    <ul class="mt-3 -mx-2 overflow-auto" role="listbox">
      ${[
        ['America/Toronto', 'UTC−05:00', true],
        ['Europe/Isle_of_Man（Douglas）', 'UTC+00:00', false],
        ['America/Thunder_Bay', 'UTC−05:00', false],
      ]
        .map(
          ([zone, offset, selected]) => `<li role="option" aria-selected="${selected}" class="flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 ${
            selected ? 'bg-tint font-bold' : ''
          }"><span>${zone}</span><span class="text-sm text-ink-muted">${offset}</span></li>`,
        )
        .join('')}
    </ul>
  </div>
</div>`;

const confirm = (name, admin, { iconName, title, text, action, danger = false }) => ({
  name,
  viewportOnly: true,
  html: page(
    '家庭管理 - 好奇星球',
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
  { name: 'family-admin', html: page('家庭管理 - 好奇星球', familyPage({ admin: true })) },
  { name: 'family-admin-edit-name', html: page('家庭管理 - 好奇星球', familyPage({ admin: true, editing: 'name' })) },
  { name: 'family-admin-edit-timezone', html: page('家庭管理 - 好奇星球', familyPage({ admin: true, editing: 'timezone' })) },
  { name: 'family-admin-timezone-picker', viewportOnly: true, html: page('家庭管理 - 好奇星球', familyPage({ admin: true, editing: 'timezone' }, timezonePicker)) },
  { name: 'family-admin-timezone-hint', html: page('家庭管理 - 好奇星球', familyPage({ admin: true, timezoneHint: true })) },
  { name: 'family-admin-member-menu', html: page('家庭管理 - 好奇星球', familyPage({ admin: true, menuOpen: true })) },
  { name: 'family-member', html: page('家庭管理 - 好奇星球', familyPage({ admin: false })) },
  {
    name: 'family-saved',
    viewportOnly: true,
    frames: [0, 125, 250, 1500, 3325, 3400],
    html: page('家庭管理 - 好奇星球', familyPage({ admin: true }, toast('party', '已保存', 'ok'))),
  },
  { name: 'new-members', html: page('新成员 - 好奇星球', membersPage(false)) },
  { name: 'new-members-empty', html: page('新成员 - 好奇星球', membersPage(true)) },
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
    title: '离开「林悦的家」？',
    text: '离开后要重新申请才能回来。',
    action: '离开',
    danger: true,
  }),
];
