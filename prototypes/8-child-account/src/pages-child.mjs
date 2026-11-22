import { logoImage } from './logos.mjs';
import { welcomeBanner } from './pages-home.mjs';
import {
  BACK,
  CHILDREN,
  art,
  avatar,
  btnPrimary,
  btnSecondary,
  btnText,
  card,
  checkbox,
  codeBoxes,
  formField,
  icon,
  page,
  publicShell,
} from './ui.mjs';

// The pages a child sees: signing in, setting a password from the login QR
// code, and the child's own home page. They carry no parent navigation; the
// type and the targets are bigger than on the parents' pages.
const [XIAOMING, DUODUO] = CHILDREN;
const FAMILY_CODE = '7KQ4MZ';
const LOGIN_TITLE = '孩子登录 - 好奇星球';
const QR_TITLE = '扫码登录 - 好奇星球';
const REMEMBER = '在这台设备上记住我';
const PASSWORD = 'xm2019abc';

// The shared buttons set their own type size, so the children's bigger size
// is marked important to win over it.
const bigPrimary = (text, extra = '') => btnPrimary(text, `min-h-14 w-full text-lg! ${extra}`);
const bigSecondary = (text, extra = '') => btnSecondary(text, `min-h-14 w-full text-lg! ${extra}`);

// The waving rabbit peeks over the card, as on the product home page it
// rises into place and then bobs gently.
const rabbit = `<div aria-hidden="true" class="w-36 animate-rabbit sm:w-44"><div class="animate-bob">${art('rabbitWave', 'w-full')}</div></div>`;

const column = (content, { withRabbit = true } = {}) =>
  publicShell(`
<div class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 px-5 py-8">
  ${withRabbit ? rabbit : ''}
  ${content}
</div>`);

const childCard = (content) => card(content, 'relative w-full animate-rise [animation-delay:150ms]');

const homeLink = btnText('回到首页', 'text-base!');

const loginFooter = `
<div class="mt-3 flex flex-col items-center gap-1 text-center">
  <p class="text-base text-ink-soft">还没有账号？请家长在「孩子」里添加。</p>
  ${homeLink}
</div>`;

/**
 * Signing in with the family code, the account and the password. The caret
 * starts in the first box of the family code. A failed attempt does not say
 * which of the three was wrong. 返回 leads back to the avatars when the device
 * remembers children; a remembered device that was revoked says why the
 * password is asked for again.
 */
const loginCard = ({ code = '', account = '', password = '', focus = 'code', error = '', back = false, notice = null } = {}) =>
  childCard(`
  ${back ? `<span class="absolute top-3 left-3">${btnText(`${BACK}返回`, 'pl-2 text-base!')}</span>` : ''}
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
  </div>
  <div class="mt-3">${checkbox(REMEMBER, { large: true })}</div>
  ${error ? `<p role="alert" class="mt-2 animate-fade text-base font-bold text-rose-ink">${error}</p>` : ''}
  ${bigPrimary('登录', 'mt-5')}`);

const loginPage = (options) => column(`${loginCard(options)}${loginFooter}`);

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

/** The top of the QR login card: the child greeted by name under the big avatar. */
const greeting = (line) => `
<div class="flex flex-col items-center text-center">
  ${avatar(XIAOMING.name, XIAOMING.color, 'size-24 text-4xl shadow-card ring-4 ring-surface')}
  <h1 class="mt-4 text-2xl font-black">你好，${XIAOMING.name}！</h1>
  <p class="mt-1 text-lg text-ink-soft">${line}</p>
</div>`;

// The QR link signs the child in on this device, so remembering it is ticked
// from the start. A field that was wrong is emptied for typing again.
const setPasswordPage = (mismatch = false) =>
  column(
    childCard(`
  ${greeting('先设一个密码，以后登录要用。')}
  <div class="mt-6 flex flex-col gap-5">
    ${formField({ id: 'new-password', label: '密码', type: 'password', value: mismatch ? PASSWORD : '', helper: '6–32 个字符', focused: !mismatch, reveal: true, large: true })}
    ${formField({ id: 'repeat-password', label: '再输一遍', type: 'password', error: mismatch ? '两次输的密码不一样' : '', reveal: true, large: true })}
  </div>
  <div class="mt-3">${checkbox(REMEMBER, { checked: true, large: true })}</div>
  ${bigPrimary('设好了，进入', 'mt-5')}`),
    { withRabbit: false },
  );

const passwordPage = (wrong = false) =>
  column(
    childCard(`
  ${greeting('输入你的密码。')}
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

// The child's home page: a light top bar with the logo, the child and 退出,
// the rabbit's welcome, and the books the parents assign, none yet.
const childHome = `
<div class="flex min-h-screen flex-col">
  <header class="flex h-20 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:h-24 sm:px-8">
    ${logoImage(56)}
    <div class="ml-auto flex items-center gap-2 sm:gap-4">
      <span class="flex items-center gap-2">${avatar(XIAOMING.name, XIAOMING.color, 'size-11 text-lg')}<span class="text-lg font-black">${XIAOMING.name}</span></span>
      ${btnSecondary(`${icon('door', 'size-6')}退出`, 'min-h-11 px-4')}
    </div>
  </header>
  <main class="flex-1 px-4 py-6 sm:px-8 sm:py-10">
    <div class="stagger mx-auto flex max-w-5xl flex-col gap-6">
      ${welcomeBanner(`你好，${XIAOMING.name}！`, { large: true })}
      ${card(`
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          ${icon('seedling', 'size-20')}
          <h2 class="text-2xl font-black">还没有书</h2>
          <p class="text-lg text-ink-soft">家长给你分派书以后，会出现在这里。</p>
        </div>`)}
    </div>
  </main>
</div>`;

const filled = { code: FAMILY_CODE, account: XIAOMING.account, password: PASSWORD, focus: '' };

export default [
  { name: 'child-login', html: page(LOGIN_TITLE, loginPage()) },
  { name: 'child-login-error', html: page(LOGIN_TITLE, loginPage({ ...filled, error: '家庭码、账号或密码不对' })) },
  { name: 'child-login-remembered', html: page(LOGIN_TITLE, rememberedPage([XIAOMING, DUODUO])) },
  { name: 'child-login-remembered-form', html: page(LOGIN_TITLE, loginPage({ back: true })) },
  {
    name: 'child-login-relogin',
    html: page(LOGIN_TITLE, loginPage({ code: FAMILY_CODE, account: XIAOMING.account, focus: 'password', back: true, notice: XIAOMING })),
  },
  { name: 'child-qr-set-password', html: page(QR_TITLE, setPasswordPage()) },
  { name: 'child-qr-set-password-error', html: page(QR_TITLE, setPasswordPage(true)) },
  { name: 'child-qr-password', html: page(QR_TITLE, passwordPage()) },
  { name: 'child-qr-password-error', html: page(QR_TITLE, passwordPage(true)) },
  { name: 'child-qr-invalid', html: page(QR_TITLE, invalidPage) },
  { name: 'child-home', html: page('好奇星球', childHome) },
];
