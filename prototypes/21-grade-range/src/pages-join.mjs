import { REQUESTS, requestList } from './requests.mjs';
import { appShell, btnPrimary, card, icon, page } from './ui.mjs';

// The 加入家庭 page: a signed-in parent applies to another family from here,
// and follows the requests already sent. Results not yet dismissed put a red
// dot on the menu entry and on the avatar.
const TITLE = '加入家庭 - 好奇星球';

const empty = `
<section class="flex flex-col gap-3">
  <h2 class="text-lg font-black">我的申请</h2>
  ${card(`<div class="flex flex-col items-center gap-2 py-6 text-center">${icon('letter', 'size-14')}<p class="font-bold text-ink-soft">还没有发出过申请</p></div>`)}
</section>`;

const joinBody = (requests) => `
<div class="stagger mx-auto flex w-full max-w-3xl flex-col gap-5">
  <header class="flex flex-col gap-1">
    <h1 class="text-3xl font-black">加入家庭</h1>
  </header>
  <div>${btnPrimary(`${icon('letter', 'size-6')}申请加入家庭`, 'w-full sm:w-auto')}</div>
  ${requests.length ? requestList(requests) : empty}
</div>`;

const joinPage = (requests, unseen) => page(TITLE, appShell({ active: 'join', unseen, content: joinBody(requests) }));

export default [
  { name: 'join-requests', html: joinPage([REQUESTS.pending, REQUESTS.approved, REQUESTS.rejected, REQUESTS.expired], true) },
  { name: 'join-requests-empty', html: joinPage([], false) },
];
