import { bookCard, bookGrid } from './books.mjs';
import { logoImage } from './logos.mjs';
import { welcomeBanner } from './pages-home.mjs';
import { editableField, fixedValue, settingsColumn, settingsField, signOutRow } from './pages-profile.mjs';
import { XIAOMI_SHELF } from './sample-books.mjs';
import {
  BACK,
  CHILDREN,
  art,
  avatar,
  badge,
  btnPrimary,
  btnSecondary,
  btnText,
  card,
  checkbox,
  codeBoxes,
  dialog,
  editSheet,
  formField,
  icon,
  page,
  publicShell,
} from './ui.mjs';

// The pages a child sees: signing in, setting a password from the login QR
// code or after signing in with the account, the child's own home page and
// the child's settings. They carry no parent navigation; the type and the
// targets are bigger than on the parents' pages.
const [XIAOMI, DOUDOU] = CHILDREN;
const FAMILY_CODE = '7KQ4MZ';
const FAMILY_NAME = '林悦的家';
const LOGIN_TITLE = '孩子登录 - 好奇星球';
const QR_TITLE = '扫码登录 - 好奇星球';
const HOME_TITLE = '好奇星球';
const PROFILE_TITLE = '个人设置 - 好奇星球';
const REMEMBER = '在这台设备上记住我';
const PASSWORD = 'xm2019abc';

// The shared buttons set their own type size, so the children's bigger size
// is marked important to win over it.
const bigPrimary = (text, extra = '') => btnPrimary(text, `min-h-14 w-full text-lg! ${extra}`);
const bigSecondary = (text, extra = '') => btnSecondary(text, `min-h-14 w-full text-lg! ${extra}`);

// The waving rabbit peeks over the card, as on the product home page it
// rises into place and then bobs gently.
const rabbit = `<div aria-hidden="true" class="w-36 animate-rabbit sm:w-44"><div class="animate-bob">${art('rabbitWave', 'w-full')}</div></div>`;

const column = (content, { withRabbit = true, overlay = '' } = {}) =>
  publicShell(
    `
<div class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 px-5 py-8">
  ${withRabbit ? rabbit : ''}
  ${content}
</div>`,
    overlay,
  );

const childCard = (content) => card(content, 'relative w-full animate-rise [animation-delay:150ms]');

const backButton = `<span class="absolute top-3 left-3">${btnText(`${BACK}返回`, 'pl-2 text-base!')}</span>`;

const homeLink = btnText('回到首页', 'text-base!');

const loginFooter = `
<div class="mt-3 flex flex-col items-center gap-1 text-center">
  <p class="text-base text-ink-soft">还没有账号？请家长在「孩子」里添加。</p>
  ${homeLink}
</div>`;

// 忘记密码 sits at the right end under the password box, in the primary
// colour like a link, and opens a dialog telling the child to ask a parent.
const forgotLink = `<div class="-mt-3 flex justify-end">${btnText('忘记密码', '-mr-3 text-primary! text-base!')}</div>`;

/**
 * Signing in with the family code, the account and the password. The caret
 * starts in the first box of the family code. A failed attempt empties the
 * password and does not say which of the three was wrong; too many failed
 * attempts say how long to wait, in the same place. 返回 leads back to the
 * avatars when the device remembers children; a remembered device that was
 * revoked says why the password is asked for again.
 */
const loginCard = ({ code = '', account = '', password = '', focus = 'code', error = '', back = false, notice = null } = {}) =>
  childCard(`
  ${back ? backButton : ''}
  <h1 class="text-center text-2xl font-black">孩子登录</h1>
  ${
    notice
      ? `<div role="status" class="mt-5 flex items-center gap-3 rounded-2xl bg-tint px-4 py-3">${avatar(notice.name, notice.color, 'size-10 text-base')}<p class="text-base font-bold">这台设备需要重新输入密码</p></div>`
      : ''
  }
  <div class="mt-6 flex flex-col gap-5">
    <div>
      <p class="text-base font-bold">家庭码</p>
      ${codeBoxes(code, { focused: focus === 'code', extra: 'mt-2' })}
    </div>
    ${formField({ id: 'account', label: '账号', value: account, focused: focus === 'account', large: true })}
    ${formField({ id: 'password', label: '密码', type: 'password', value: password, focused: focus === 'password', reveal: true, large: true })}
    ${forgotLink}
  </div>
  <div class="mt-1">${checkbox(REMEMBER, { large: true })}</div>
  ${error ? `<p role="alert" class="mt-2 animate-fade text-base font-bold text-rose-ink">${error}</p>` : ''}
  ${bigPrimary('登录', 'mt-5')}`);

const loginPage = (options, overlay = '') => column(`${loginCard(options)}${loginFooter}`, { overlay });

const forgotDialog = dialog({
  iconName: 'key',
  title: '忘记密码了？',
  body: '<p class="mt-3 text-base text-ink-soft">请家长在「孩子」里点「重设密码」。之后 48 小时内用账号登录，或者扫家长给的二维码，就能设一个新密码。</p>',
  actions: btnPrimary('知道了'),
});

// Every child remembered on this device is one big avatar to tap.
const rememberedPage = (children) =>
  column(`
${childCard(`
  <h1 class="text-center text-2xl font-black">点你的头像登录</h1>
  <ul class="mt-6 flex flex-wrap justify-center gap-3 sm:gap-6">
    ${children
      .map(
        (c) => `<li><button type="button" class="flex w-36 flex-col items-center gap-3 rounded-3xl p-3 transition duration-100 hover:bg-canvas active:scale-[0.97]">
          ${avatar(c.name, c.color, 'size-24 text-4xl shadow-card ring-4 ring-surface sm:size-28 sm:text-5xl')}
          <span class="text-xl font-black">${c.name}</span>
        </button></li>`,
      )
      .join('')}
  </ul>
  ${bigSecondary('用账号登录', 'mt-6')}`)}
<div class="mt-3">${homeLink}</div>`);

/** The top of a card for one known child: the child greeted by name under the big avatar. */
const greeting = (child, line) => `
<div class="flex flex-col items-center text-center">
  ${avatar(child.name, child.color, 'size-24 text-4xl shadow-card ring-4 ring-surface')}
  <h1 class="mt-4 text-2xl font-black">你好，${child.name}！</h1>
  <p class="mt-1 text-lg text-ink-soft">${line}</p>
</div>`;

// Setting the first password signs the child in on this device, so remembering
// it is ticked from the start. A field that was wrong is emptied for typing
// again.
const setPasswordCard = (child, { mismatch = false, back = false } = {}) =>
  childCard(`
  ${back ? backButton : ''}
  ${greeting(child, '先设一个密码，以后登录要用。')}
  <div class="mt-6 flex flex-col gap-5">
    ${formField({ id: 'new-password', label: '密码', type: 'password', value: mismatch ? PASSWORD : '', helper: '6–32 个字符', focused: !mismatch, reveal: true, large: true })}
    ${formField({ id: 'repeat-password', label: '再输一遍', type: 'password', error: mismatch ? '两次输的密码不一样' : '', reveal: true, large: true })}
  </div>
  <div class="mt-3">${checkbox(REMEMBER, { checked: true, large: true })}</div>
  ${bigPrimary('设好了，进入', 'mt-5')}`);

const qrSetPasswordPage = (mismatch = false) => column(setPasswordCard(XIAOMI, { mismatch }), { withRabbit: false });

// A child without a password who signed in with the family code and the
// account sets it on the login page itself; 返回 leads back to the form.
const loginSetPasswordPage = column(`${setPasswordCard(DOUDOU, { back: true })}${loginFooter}`);

const passwordPage = (wrong = false) =>
  column(
    childCard(`
  ${greeting(XIAOMI, '输入你的密码。')}
  <div class="mt-6">
    ${formField({ id: 'password', label: '密码', type: 'password', error: wrong ? '密码不对' : '', focused: !wrong, reveal: true, large: true })}
  </div>
  <div class="mt-3">${checkbox(REMEMBER, { checked: true, large: true })}</div>
  ${bigPrimary('登录', 'mt-5')}`),
    { withRabbit: false },
  );

const invalidPage = column(
  childCard(`
  <div class="flex flex-col items-center text-center">
    <h1 class="text-2xl font-black">这个二维码已经失效了</h1>
    <p class="mt-2 text-lg text-ink-soft">请家长重新给你一个二维码。</p>
    ${bigPrimary('去登录页', 'mt-6')}
  </div>`),
);

/**
 * The child's avatar, a link to the child's settings at /child/profile, read
 * out as 个人设置. From 1024 px the nickname stands beside it; below that the
 * avatar alone. On the settings page the link is shown as the current one.
 */
const profileLink = (child, current = false) => `
<a href="/child/profile" aria-label="个人设置"${current ? ' aria-current="page"' : ''} class="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full p-1 lg:pr-4 ${
  current ? 'bg-tint' : 'hover:bg-canvas'
}">
  ${avatar(child.name, child.color, 'size-11 text-lg')}
  <span aria-hidden="true" class="hidden text-lg font-black lg:inline">${child.name}</span>
</a>`;

// The frame of a signed-in child's pages: a light top bar with the logo and
// the child's avatar.
const childShell = (content, { overlay = '', current = false } = {}) => `
<div class="flex min-h-screen flex-col">
  <header class="flex h-20 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:h-24 sm:px-8">
    ${logoImage(56)}
    <div class="ml-auto">${profileLink(XIAOMI, current)}</div>
  </header>
  <main class="flex-1 px-4 py-6 sm:px-8 sm:py-10">${content}</main>
  ${overlay}
</div>`;

const noBooks = card(`
  <div class="flex flex-col items-center gap-3 py-8 text-center">
    ${icon('seedling', 'size-20')}
    <h2 class="text-2xl font-black">还没有书</h2>
    <p class="text-lg text-ink-soft">家长给你分派书以后，会出现在这里。</p>
  </div>`);

// The child's books, newest assignment first and all at once, as cards like
// the library's without the footer. The red count beside the heading and the
// 新 on a cover tell of books the child has not opened yet.
const myBooks = (shelf) => {
  const unopened = shelf.filter((b) => b.isNew).length;
  return `
<section class="flex flex-col gap-4">
  <h2 class="flex items-center gap-2 text-2xl font-black">我的书${unopened ? `${badge(unopened)}<span class="sr-only">，${unopened} 本新书</span>` : ''}</h2>
  ${bookGrid(shelf.map((b) => bookCard(b, { footer: false, link: false, isNew: b.isNew })))}
</section>`;
};

// The child's home page: the rabbit's welcome and the books the parents assign.
const childHome = (shelf) =>
  childShell(`
<div class="stagger mx-auto flex max-w-5xl flex-col gap-6">
  ${welcomeBanner(`你好，${XIAOMI.name}！`)}
  ${shelf.length ? myBooks(shelf) : noBooks}
</div>`);

// The child's settings: the nickname, edited like the parent's name (in place
// with a mouse, in a sheet on touch screens), the account and the family
// shown as they are, and signing out. 返回 leads back to 我的书.
const childProfile = ({ editing = false, error = '' } = {}) =>
  childShell(
    settingsColumn(
      `${card(`<div class="divide-y divide-line">
        ${editableField({ label: '昵称', value: XIAOMI.name, pencilLabel: '改昵称', editing, error })}
        ${settingsField('账号', fixedValue(XIAOMI.account))}
        ${settingsField('家庭', fixedValue(FAMILY_NAME))}
      </div>`)}
      ${signOutRow}`,
      true,
    ),
    {
      current: true,
      overlay: editing ? editSheet({ title: '改昵称', value: XIAOMI.name, label: '昵称', error }) : '',
    },
  );

const filled = { code: FAMILY_CODE, account: XIAOMI.account, focus: '' };

export default [
  { name: 'child-login', html: page(LOGIN_TITLE, loginPage()) },
  { name: 'child-login-error', html: page(LOGIN_TITLE, loginPage({ ...filled, error: '家庭码、账号或密码不对' })) },
  { name: 'child-login-rate-limited', html: page(LOGIN_TITLE, loginPage({ ...filled, error: '试得太多了，请 8 分钟后再试' })) },
  { name: 'dialog-forgot-password', viewportOnly: true, html: page(LOGIN_TITLE, loginPage({}, forgotDialog)) },
  { name: 'child-login-set-password', html: page(LOGIN_TITLE, loginSetPasswordPage) },
  { name: 'child-login-remembered', html: page(LOGIN_TITLE, rememberedPage([XIAOMI, DOUDOU])) },
  { name: 'child-login-remembered-form', html: page(LOGIN_TITLE, loginPage({ back: true })) },
  {
    name: 'child-login-relogin',
    html: page(LOGIN_TITLE, loginPage({ code: FAMILY_CODE, account: XIAOMI.account, focus: 'password', back: true, notice: XIAOMI })),
  },
  { name: 'child-qr-set-password', html: page(QR_TITLE, qrSetPasswordPage()) },
  { name: 'child-qr-set-password-error', html: page(QR_TITLE, qrSetPasswordPage(true)) },
  { name: 'child-qr-password', html: page(QR_TITLE, passwordPage()) },
  { name: 'child-qr-password-error', html: page(QR_TITLE, passwordPage(true)) },
  { name: 'child-qr-invalid', html: page(QR_TITLE, invalidPage) },
  { name: 'child-home', html: page(HOME_TITLE, childHome([])) },
  { name: 'child-home-books', html: page(HOME_TITLE, childHome(XIAOMI_SHELF)) },
  { name: 'child-profile', html: page(PROFILE_TITLE, childProfile()) },
  { name: 'child-profile-edit-nickname', viewportOnly: 'touch', html: page(PROFILE_TITLE, childProfile({ editing: true })) },
  { name: 'child-profile-edit-nickname-error', viewportOnly: 'touch', html: page(PROFILE_TITLE, childProfile({ editing: true, error: '请填昵称' })) },
];
