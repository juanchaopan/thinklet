import { appShell, art, btnPrimary, btnSecondary, card, chip, icon, page, publicShell } from './ui.mjs';

// The full-body rabbit points toward the viewer's right, so it stands to the
// left of its speech bubble. It rises into place, the bubble pops up after it,
// and then the rabbit bobs gently while the page is open.
const heroArt = `
<div aria-hidden="true" class="relative mx-auto flex w-full max-w-md items-end justify-center">
  <div class="absolute inset-x-6 top-16 bottom-0 animate-fade rounded-[3rem] bg-gradient-to-br from-peach via-surface to-tint ring-1 ring-line"></div>
  <div class="relative z-[1] w-52 animate-rabbit sm:w-64 lg:w-72"><div class="animate-bob">${art('rabbit', 'w-full')}</div></div>
  <div class="absolute top-6 right-0 z-[2] max-w-44 origin-bottom-left animate-bubble rounded-3xl rounded-bl-md bg-surface px-4 py-3 text-base font-bold text-ink shadow-pop sm:top-10 sm:right-2">
    一起把难题<br />想明白吧！
  </div>
</div>`;

export const homeVisitorBody = `
<section class="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-0">
  <div class="stagger flex flex-col items-center text-center lg:items-start lg:text-left">
    <div>${chip('给 3–18 岁的孩子', 'violet')}</div>
    <h1 class="mt-5 text-4xl leading-tight font-black tracking-tight sm:text-5xl lg:text-6xl">把难懂的课，<br />变成好玩的题</h1>
    <p class="mt-5 max-w-lg text-lg leading-relaxed text-ink-soft">用有趣的方式带孩子学习难懂、复杂的课程，教他们解题，帮他们整理思路。</p>
    <div class="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
      ${btnPrimary('家长登录 / 注册', 'sm:min-w-48')}
      ${btnSecondary('孩子登录', 'sm:min-w-48')}
    </div>
  </div>
  ${heroArt}
</section>`;

// The half-body rabbit waves from the right edge of the banner and is cut off
// at its waist by the banner's bottom edge. Each line of the greeting is kept
// whole, so it never breaks in the middle of a phrase.
const welcomeBanner = `
<section class="relative overflow-hidden rounded-card bg-gradient-to-r from-surface via-peach/60 to-tint ring-1 ring-line">
  <div class="relative z-[1] py-7 pl-5 sm:py-10 sm:pl-8">
    <p class="text-sm font-bold text-ink-soft sm:text-base">欢迎回来，林悦</p>
    <h1 class="mt-2 text-xl leading-snug font-black sm:text-3xl"><span class="whitespace-nowrap">我是小兔老师，</span><br /><span class="whitespace-nowrap">今天也一起学习吧！</span></h1>
  </div>
  <div aria-hidden="true" class="absolute right-0 -bottom-2 w-32 animate-rabbit [animation-delay:120ms] sm:right-8 sm:w-52 lg:right-16 lg:w-60">${art('rabbitWave', 'w-full')}</div>
</section>`;

export const homeSignedInBody = `
<div class="stagger mx-auto flex max-w-5xl flex-col gap-6">
  ${welcomeBanner}
  ${card(`
    <div class="flex flex-wrap items-center gap-4">
      ${icon('family', 'size-12')}
      <div class="min-w-0 flex-1">
        <h2 class="text-lg font-black">林悦的家</h2>
        <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">${chip('管理员', 'sun')}<span>3 位家长</span></p>
      </div>
      ${btnSecondary('家庭管理', 'w-full sm:w-auto')}
    </div>
  `)}
</div>`;

export default [
  { name: 'home-visitor', html: page('thinklet', publicShell(homeVisitorBody)) },
  { name: 'home-visitor-entering', frames: [0, 150, 350, 600], html: page('thinklet', publicShell(homeVisitorBody)) },
  { name: 'home-signed-in', html: page('thinklet', appShell({ active: 'home', content: homeSignedInBody })) },
  {
    name: 'home-signed-in-entering',
    frames: [0, 120, 300, 620],
    html: page('thinklet', appShell({ active: 'home', content: homeSignedInBody })),
  },
];
