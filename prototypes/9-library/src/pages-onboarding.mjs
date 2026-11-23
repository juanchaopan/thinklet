import { libraryHome } from './pages-library.mjs';
import { REQUESTS, requestList } from './requests.mjs';
import { appShell, avatar, bareShell, btnPrimary, btnSecondary, codeBoxes, dialog, icon, page, timezoneField } from './ui.mjs';

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

// With requests sent, the start page lists them with the same cards as the
// 加入家庭 page, above the two ways to get a family.
const withRequests = (requests) =>
  narrow(`
<h1 class="text-3xl font-black">欢迎，林悦</h1>
${requestList(requests)}
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

// The family code is looked up as soon as the sixth box is filled, so there is
// no button to submit it; an unknown code shakes the boxes and says so.
const joinDialog = (typed, error) =>
  dialog({
    iconName: 'letter',
    title: '申请加入家庭',
    wide: true,
    body: codeBoxes(typed, { error: error ? '没有这个家庭码' : '' }),
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

const overStart = (overlay) => bareShell(startBody, { overlay });

const TITLE = '开始 - 好奇星球';

export default [
  { name: 'start', html: page(TITLE, bareShell(startBody)) },
  { name: 'start-waiting', html: page(TITLE, bareShell(withRequests([REQUESTS.pending, REQUESTS.rejected]), { unseen: true })) },
  { name: 'start-expired', html: page(TITLE, bareShell(withRequests([REQUESTS.expired]), { unseen: true })) },
  { name: 'family-create', viewportOnly: true, html: page('创建家庭 - 好奇星球', overStart(createDialog(false))) },
  { name: 'family-create-error', viewportOnly: true, html: page('创建家庭 - 好奇星球', overStart(createDialog(true))) },
  {
    name: 'family-create-from-menu',
    viewportOnly: true,
    html: page('创建家庭 - 好奇星球', appShell({ active: 'library', content: libraryHome, overlay: createDialog(false) })),
  },
  { name: 'family-create-opening', viewportOnly: true, frames: [0, 100, 300], html: page('创建家庭 - 好奇星球', overStart(createDialog(false))) },
  { name: 'family-join', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinDialog('7KQ', false))) },
  { name: 'family-join-error', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinDialog('7KQ4MW', true))) },
  { name: 'family-join-confirm', viewportOnly: true, html: page('申请加入家庭 - 好奇星球', overStart(joinConfirmDialog)) },
];
