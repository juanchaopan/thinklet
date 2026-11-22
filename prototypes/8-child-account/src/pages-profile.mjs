import { ADMIN, BACK, PENCIL, appShell, bareShell, btnIcon, btnSecondary, btnText, card, editRow, editSheet, icon, page, textInput } from './ui.mjs';

// The parent's own settings: the name, edited like the family name (in place
// with a mouse, in a sheet on touch screens), the email as Authing reports it,
// and signing out. A parent with no family reaches it from the start page,
// without the family menus, and returns there with 返回.
const TITLE = '个人设置 - 好奇星球';

const field = (label, content) => `
<div class="py-5 first:pt-0 last:pb-0">
  <p class="text-sm font-bold text-ink-muted">${label}</p>
  <div class="mt-1">${content}</div>
</div>`;

const nameView = (extra = '') =>
  `<div class="flex items-center gap-1 ${extra}"><p class="text-base font-bold">${ADMIN.name}</p>${btnIcon(PENCIL, '改名字')}</div>`;

// While the name is being edited, a touch screen keeps showing the name here
// and edits it in the sheet; with a mouse the name gives way to the edit row.
const nameField = (editing, error) =>
  field(
    '名字',
    editing
      ? `${nameView('mouse:hidden')}<div class="hidden mouse:block">${editRow(textInput(ADMIN.name, '名字', error), Boolean(error))}</div>`
      : nameView(),
  );

const emailField = field('邮箱', `<p class="flex min-h-11 items-center text-base font-bold">${ADMIN.email ?? '—'}</p>`);

const profileBody = ({ editing = false, error = '', back = false } = {}) => `
<div class="stagger mx-auto flex w-full max-w-3xl flex-col gap-5">
  ${back ? `<div>${btnText(`${BACK}返回`, '-ml-3 pl-2')}</div>` : ''}
  <header class="flex flex-col gap-1">
    <h1 class="text-3xl font-black">个人设置</h1>
  </header>
  ${card(`<div class="divide-y divide-line">${nameField(editing, error)}${emailField}</div>`)}
  <div class="flex justify-end">${btnSecondary(`${icon('door', 'size-6')}退出登录`, 'w-full sm:w-auto')}</div>
</div>`;

const profilePage = (options = {}) =>
  page(
    TITLE,
    appShell({
      active: 'profile',
      content: profileBody(options),
      overlay: options.editing ? editSheet({ title: '改名字', value: ADMIN.name, label: '名字', error: options.error }) : '',
    }),
  );

export default [
  { name: 'profile', html: profilePage() },
  { name: 'profile-edit-name', viewportOnly: 'touch', html: profilePage({ editing: true }) },
  { name: 'profile-edit-name-error', viewportOnly: 'touch', html: profilePage({ editing: true, error: '请填名字' }) },
  { name: 'profile-no-family', html: page(TITLE, bareShell(profileBody({ back: true }))) },
];
