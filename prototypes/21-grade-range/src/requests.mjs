import { btnSecondary, card, chip, icon } from './ui.mjs';

// The parent's own join requests, as the start page and the 加入家庭 page list
// them: one card each, newest first, with the family, its admin, the day the
// request was sent, the status and the one action that status allows.
const STATUS = {
  pending: { label: '等待中', tone: 'sun', iconName: 'hourglass', action: '撤回' },
  approved: { label: '已同意', tone: 'mint', iconName: 'letter', action: '知道了' },
  rejected: { label: '被拒绝', tone: 'rose', iconName: 'letter', action: '知道了' },
  expired: { label: '已失效', tone: 'gray', iconName: 'letter', action: '知道了', note: '家庭码已更换' },
};

/** Sample requests of 林悦, one per status. */
export const REQUESTS = {
  pending: { family: '舅舅家', admin: '王建华', sent: '11月21日', status: 'pending' },
  approved: { family: '外婆家', admin: '周秀英', sent: '11月18日', status: 'approved' },
  rejected: { family: '周家', admin: '周子航', sent: '11月15日', status: 'rejected' },
  expired: { family: '姑姑家', admin: '林美华', sent: '11月6日', status: 'expired' },
};

const requestCard = ({ family, admin, sent, status }) => {
  const s = STATUS[status];
  return card(`
<div class="flex flex-wrap items-center gap-x-4 gap-y-3">
  ${icon(s.iconName, 'size-10')}
  <div class="min-w-0 flex-1">
    <p class="flex flex-wrap items-center gap-2"><span class="text-lg font-black">${family}</span>${chip(s.label, s.tone)}</p>
    <p class="mt-1 text-sm text-ink-soft">管理员 ${admin} · ${sent}申请</p>
    ${s.note ? `<p class="mt-1 text-sm text-ink-muted">${s.note}</p>` : ''}
  </div>
  ${btnSecondary(s.action, 'min-h-11 w-full px-5 text-sm sm:w-auto')}
</div>`);
};

/** The heading 我的申请 over one card per request. */
export const requestList = (requests) => `
<section class="flex flex-col gap-3">
  <h2 class="text-lg font-black">我的申请</h2>
  ${requests.map(requestCard).join('')}
</section>`;
