import { FAMILIES } from './pages-misc.mjs';
import {
  ADMIN,
  BACK,
  MEMBER,
  PENCIL,
  appShell,
  bareShell,
  btnIcon,
  btnSecondary,
  btnText,
  card,
  confirmDialog,
  editRow,
  editSheet,
  icon,
  page,
  textInput,
} from './ui.mjs';

// A parent's own settings: the name, edited like the family name (in place
// with a mouse, in a sheet on touch screens), the email as Authing reports it,
// signing out, and deleting the account at the very end, set apart under a
// line. A parent with no family reaches it from the start page, without the
// family menus, and returns there with 返回.
//
// The pages show 周子航, an ordinary member of 林悦的家 and admin of no family,
// who can delete the account; and 林悦, the admin of two families, who cannot
// yet. 林悦 without any family can delete it again.
const TITLE = '个人设置 - 好奇星球';

/** The families of 周子航: an ordinary member of 林悦的家 and admin of none. */
const MEMBER_FAMILIES = [{ name: '林悦的家', admin: false }];

/** One labelled value of a settings card. */
export const settingsField = (label, content) => `
<div class="py-5 first:pt-0 last:pb-0">
  <p class="text-sm font-bold text-ink-muted">${label}</p>
  <div class="mt-1">${content}</div>
</div>`;

/** A value shown as it is, as tall as an editable one so the rows line up. */
export const fixedValue = (value) => `<p class="flex min-h-11 items-center text-base font-bold">${value}</p>`;

const editableView = (value, pencilLabel, extra = '') =>
  `<div class="flex items-center gap-1 ${extra}"><p class="text-base font-bold">${value}</p>${btnIcon(PENCIL, pencilLabel)}</div>`;

/**
 * A value with a pencil button. While it is being edited, a touch screen keeps
 * showing the value here and edits it in a sheet; with a mouse the value gives
 * way to the edit row.
 */
export const editableField = ({ label, value, pencilLabel, editing = false, error = '' }) =>
  settingsField(
    label,
    editing
      ? `${editableView(value, pencilLabel, 'mouse:hidden')}<div class="hidden mouse:block">${editRow(textInput(value, label, error), Boolean(error))}</div>`
      : editableView(value, pencilLabel),
  );

/** 退出登录 at the right end under the settings card, the full width on phones. */
export const signOutRow = `<div class="flex justify-end">${btnSecondary(`${icon('door', 'size-6')}退出登录`, 'w-full sm:w-auto')}</div>`;

const quoted = (families) => families.map((f) => `「${f.name}」`).join('');

/**
 * Deleting the account is set apart under a line, like 从我家的书里移除 on the
 * book page. While the parent is the admin of a family it works like 离开家庭
 * for a family's admin: the button is dimmed, with the reason before it, and
 * on a narrow screen the reason goes on the line above.
 */
const deleteRow = (adminOf) =>
  adminOf.length
    ? `<div class="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4 text-sm text-ink-muted">
         <span class="text-right">你还是${quoted(adminOf)}的管理员，先把管理员设给别人或者删除家庭，才能删除账号</span>
         ${btnText('删除账号', 'cursor-not-allowed opacity-40')}
       </div>`
    : `<div class="flex justify-end border-t border-line pt-4">${btnText('删除账号', 'text-rose-ink')}</div>`;

/** The settings page's column: 返回 when there is one, the title, then the content. */
export const settingsColumn = (content, back = false) => `
<div class="stagger mx-auto flex w-full max-w-3xl flex-col gap-5">
  ${back ? `<div>${btnText(`${BACK}返回`, '-ml-3 pl-2')}</div>` : ''}
  <header class="flex flex-col gap-1">
    <h1 class="text-3xl font-black">个人设置</h1>
  </header>
  ${content}
</div>`;

const profileBody = ({ parent = MEMBER, adminOf = [], editing = false, error = '', back = false } = {}) =>
  settingsColumn(
    `${card(`<div class="divide-y divide-line">
      ${editableField({ label: '名字', value: parent.name, pencilLabel: '改名字', editing, error })}
      ${settingsField('邮箱', fixedValue(parent.email ?? '—'))}
    </div>`)}
    ${signOutRow}
    ${deleteRow(adminOf)}`,
    back,
  );

// The parent's family stays the current one in the navigation; an ordinary
// member sees no request counts.
const profilePage = (options = {}, overlay = '') => {
  const parent = options.parent ?? MEMBER;
  return page(
    TITLE,
    appShell({
      active: 'profile',
      parent,
      admin: parent === ADMIN,
      content: profileBody(options),
      overlay: options.editing ? editSheet({ title: '改名字', value: parent.name, label: '名字', error: options.error }) : overlay,
    }),
  );
};

/** Family names in a sentence: 「甲」, 「甲」和「乙」, 「甲」、「乙」和「丙」. */
const inSentence = (families) => {
  const names = families.map((f) => `「${f.name}」`);
  return names.length > 1 ? `${names.slice(0, -1).join('、')}和${names.at(-1)}` : names.join('');
};

// Every family the parent belongs to is named, as they leave them all.
const deleteAccountDialog = (families) =>
  confirmDialog({
    iconName: 'door',
    title: '删除你的账号？',
    text: `你会离开${inSentence(families)}。你在好奇星球和 Authing 上的账号都会删掉，不能恢复。`,
    action: '删除账号',
    danger: true,
  });

export default [
  { name: 'profile', html: profilePage() },
  { name: 'profile-edit-name', viewportOnly: 'touch', html: profilePage({ editing: true }) },
  { name: 'profile-edit-name-error', viewportOnly: 'touch', html: profilePage({ editing: true, error: '请填名字' }) },
  { name: 'profile-admin', html: profilePage({ parent: ADMIN, adminOf: FAMILIES.filter((f) => f.admin) }) },
  { name: 'profile-no-family', html: page(TITLE, bareShell(profileBody({ parent: ADMIN, back: true }))) },
  { name: 'dialog-delete-account', viewportOnly: true, html: profilePage({}, deleteAccountDialog(MEMBER_FAMILIES)) },
];
