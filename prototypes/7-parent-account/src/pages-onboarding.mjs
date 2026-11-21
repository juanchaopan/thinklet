import { homeSignedInBody } from './pages-home.mjs';
import {
  appShell,
  avatar,
  bareShell,
  btnPrimary,
  btnSecondary,
  card,
  chip,
  dialog,
  icon,
  page,
  timezoneField,
} from './ui.mjs';

const narrow = (content) => `<div class="stagger mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 py-6">${content}</div>`;

const choice = (iconName, title, text) => `
<a href="#" class="flex items-center gap-4 rounded-card border border-line bg-surface p-5 shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-pop">
  ${icon(iconName, 'size-12')}
  <span class="min-w-0 flex-1">
    <span class="block text-lg font-black">${title}</span>
    <span class="mt-0.5 block text-sm text-ink-soft">${text}</span>
  </span>
  <svg class="size-5 shrink-0 text-ink-muted" viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
</a>`;

const choices = `
<div class="flex flex-col gap-3">
  ${choice('seedling', '创建家庭', '你来当管理员')}
  ${choice('letter', '申请加入家庭', '用家人给的家庭码')}
</div>`;

const startBody = narrow(`
<div><h1 class="text-3xl font-black">欢迎，林悦</h1><p class="mt-2 text-base text-ink-soft">先创建或加入一个家庭。</p></div>
${choices}`);

const request = ({ family, admin, status }) => {
  const states = {
    pending: { tone: 'sun', label: '等待同意', iconName: 'hourglass', action: btnSecondary('撤回', 'min-h-11 px-5 text-sm') },
    rejected: { tone: 'rose', label: '未被同意', iconName: 'letter', action: btnSecondary('知道了', 'min-h-11 px-5 text-sm') },
    expired: { tone: 'gray', label: '已失效', iconName: 'letter', action: btnSecondary('知道了', 'min-h-11 px-5 text-sm') },
  };
  const s = states[status];
  return `
<li class="flex items-center gap-3 py-4 first:pt-0 last:pb-0">
  ${icon(s.iconName, 'size-10')}
  <div class="min-w-0 flex-1">
    <p class="font-bold">${family}</p>
    <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">${chip(s.label, s.tone)}<span>管理员 ${admin}</span></p>
  </div>
  ${s.action}
</li>`;
};

const waitingBody = narrow(`
<h1 class="text-3xl font-black">欢迎，林悦</h1>
${card(`
  <h2 class="text-lg font-black">我的加入申请</h2>
  <ul class="mt-4 divide-y divide-line">
    ${request({ family: '外婆家', admin: '周秀英', status: 'pending' })}
    ${request({ family: '周家', admin: '周子航', status: 'rejected' })}
  </ul>
`)}
${choices}`);

const nameField = (error) => `
<label class="block">
  <span class="text-sm font-bold">家庭名称</span>
  <input type="text" value="${error ? '' : '林悦的家'}" ${error ? 'aria-invalid="true"' : ''} class="mt-2 block min-h-12 w-full rounded-2xl border bg-surface px-4 text-base outline-none ${
    error ? 'animate-shake border-rose-ink ring-2 ring-rose' : 'border-line-strong'
  }" />
  ${error ? '<span class="mt-2 block animate-fade text-sm font-bold text-rose-ink">请填家庭名称</span>' : ''}
</label>`;

const createDialog = (error) =>
  dialog({
    iconName: 'seedling',
    title: '创建家庭',
    wide: true,
    body: `<div class="mt-6 flex flex-col gap-5">
      ${nameField(error)}
      <div><span class="text-sm font-bold">时区</span><div class="mt-2">${timezoneField()}</div></div>
    </div>`,
    actions: `${btnSecondary('取消')}${btnPrimary('创建')}`,
  });

/**
 * Six boxes, one per character of the family code, like a verification code.
 * The code is looked up as soon as the sixth box is filled, so there is no
 * button to submit it; an unknown code shakes the boxes and says so.
 */
const codeBoxes = (typed, { error = false } = {}) => {
  const chars = [...typed.padEnd(6, ' ')];
  const focusAt = error ? -1 : typed.length;
  return `
<div class="mt-6 grid grid-cols-6 gap-2 sm:gap-3 ${error ? 'animate-shake' : ''}" role="group" aria-label="家庭码，6 位">
  ${chars
    .map((c, i) => {
      const state = error
        ? 'border-rose-ink bg-rose/40'
        : i === focusAt
          ? 'border-violet ring-2 ring-violet/20 bg-surface'
          : c.trim()
            ? 'border-line-strong bg-surface'
            : 'border-line bg-canvas';
      return `<span class="flex aspect-[4/5] items-center justify-center rounded-2xl border-2 font-mono text-2xl font-black transition-colors duration-100 sm:text-3xl ${state}">${
        c.trim() || (i === focusAt ? '<span class="h-7 w-0.5 animate-pulse bg-violet"></span>' : '')
      }</span>`;
    })
    .join('')}
</div>
${error ? '<p class="mt-3 animate-fade text-sm font-bold text-rose-ink">没有这个家庭码</p>' : ''}`;
};

const joinDialog = (typed, error) =>
  dialog({
    iconName: 'letter',
    title: '申请加入家庭',
    wide: true,
    body: codeBoxes(typed, { error }),
    actions: btnSecondary('取消'),
  });

const joinConfirmDialog = dialog({
  title: '申请加入这个家庭？',
  wide: true,
  body: `<div class="mt-5 flex items-center gap-4 rounded-2xl bg-tint p-4">
    ${icon('family', 'size-12')}
    <div class="min-w-0">
      <p class="text-lg font-black">外婆家</p>
      <p class="mt-1 flex items-center gap-2 text-sm text-ink-soft">${avatar('周秀英', 2, 'size-6 text-xs')}管理员 周秀英</p>
    </div>
  </div>`,
  actions: `${btnSecondary('换一个家庭码')}${btnPrimary('发送申请')}`,
});

const overStart = (overlay) => bareShell(startBody, overlay);

export default [
  { name: 'start', html: page('开始 - 好奇星球', bareShell(startBody)) },
  { name: 'start-waiting', html: page('开始 - 好奇星球', bareShell(waitingBody)) },
  { name: 'family-create', viewportOnly: true, html: page('创建家庭 - 好奇星球', overStart(createDialog(false))) },
  { name: 'family-create-error', viewportOnly: true, html: page('创建家庭 - 好奇星球', overStart(createDialog(true))) },
  {
    name: 'family-create-from-menu',
    viewportOnly: true,
    html: page('创建家庭 - 好奇星球', appShell({ active: 'home', content: homeSignedInBody, overlay: createDialog(false) })),
  },
  { name: 'family-create-opening', viewportOnly: true, frames: [0, 100, 300], html: page('创建家庭 - 好奇星球', overStart(createDialog(false))) },
  { name: 'family-join', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinDialog('7KQ', false))) },
  { name: 'family-join-error', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinDialog('7KQ4MW', true))) },
  { name: 'family-join-confirm', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinConfirmDialog)) },
];
