import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { HandledJoinRequest } from '@thinklet/contracts';
import { FamilyTroubleView, followFamily } from '../../core/family-pages';
import { Art } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card, Chip, type ChipTone } from '../../shared/ui/card';
import { formatDate } from '../../shared/ui/dates';
import { LineIcon } from '../../shared/ui/line-icon';
import { NewMembersStore, type RequestList } from './new-members-store';

/** How each result of a handled request is labelled (rules.md, 新成员（管理员）). */
const RESULTS: Record<HandledJoinRequest['status'], { label: string; tone: ChipTone }> = {
  approved: { label: '已同意', tone: 'mint' },
  rejected: { label: '已拒绝', tone: 'rose' },
  expired: { label: '已失效', tone: 'gray' },
};

/**
 * The new members page at `/families/:familyId/new-members`, for the
 * family's admin (rules.md, 新成员（管理员）): 等你处理, the waiting requests
 * with each applicant's name, email and the time they asked, to approve
 * (同意) or reject (拒绝); and 处理过的, the approved, rejected and expired
 * ones with the day they were closed, until the admin clears them with
 * 知道了. Without waiting requests it says 没有新的申请, and the handled card
 * is left out when it is empty. Times are in the family's time zone.
 *
 * A handled or cleared row slides out to the right while its height
 * closes. The requests are read again whenever the window comes back to the
 * front. A family the parent is not in says 找不到这个家庭.
 */
@Component({
  selector: 'app-new-members',
  providers: [NewMembersStore],
  imports: [Art, Avatar, Button, Card, Chip, FamilyTroubleView, LineIcon],
  template: `
    @if (store.problem(); as trouble) {
      <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
    } @else if (store.requests(); as lists) {
      <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
        <header class="flex flex-col gap-1">
          <p class="text-sm font-bold text-ink-muted">{{ store.family()?.name }}</p>
          <h1 class="text-3xl font-black">新成员</h1>
        </header>
        <section appCard>
          <h2 class="text-lg font-black">等你处理</h2>
          @if (lists.pending.length > 0) {
            <ul class="mt-4 divide-y divide-line">
              @for (request of lists.pending; track request.id) {
                <li
                  class="flex flex-wrap items-center gap-3 overflow-hidden py-4 first:pt-0 last:pb-0"
                  [class.animate-slide-away]="store.isLeaving('pending', request.id)"
                >
                  <app-avatar [name]="request.name" [personId]="request.parentId" size="list" />
                  <div class="min-w-0 flex-1">
                    <p [id]="nameId('pending', request.id)" class="font-bold">{{ request.name }}</p>
                    <p class="truncate text-sm text-ink-soft">
                      {{ request.email ?? '—' }} · {{ timeOf(request.createdAt, true) }}
                    </p>
                  </div>
                  <div class="flex w-full gap-2 sm:w-auto">
                    <button
                      type="button"
                      appButton="text"
                      class="flex-1 border border-line sm:flex-none"
                      [attr.aria-describedby]="nameId('pending', request.id)"
                      [disabled]="store.busy().has(request.id)"
                      (click)="store.decide(request, 'reject')"
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      appButton
                      [compact]="true"
                      class="flex-1 sm:flex-none"
                      [attr.aria-describedby]="nameId('pending', request.id)"
                      [disabled]="store.busy().has(request.id)"
                      (click)="store.decide(request, 'approve')"
                    >
                      <app-line-icon name="check" />同意
                    </button>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <div class="flex flex-col items-center gap-2 py-6 text-center">
              <img alt="" appArt="letter" class="size-14" />
              <p class="font-bold text-ink-soft">没有新的申请</p>
            </div>
          }
        </section>
        @if (lists.handled.length > 0) {
          <section appCard>
            <h2 class="text-lg font-black">处理过的</h2>
            <ul class="mt-2 divide-y divide-line">
              @for (request of lists.handled; track request.id) {
                <li
                  class="flex items-center gap-3 overflow-hidden py-3"
                  [class.animate-slide-away]="store.isLeaving('handled', request.id)"
                >
                  <app-avatar
                    [name]="request.name"
                    [personId]="request.parentId"
                    size="large"
                    class="opacity-80"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-2 font-bold">
                      <span [id]="nameId('handled', request.id)">{{ request.name }}</span>
                      <span [appChip]="result(request).tone">{{ result(request).label }}</span>
                    </p>
                    <p class="truncate text-sm text-ink-soft">
                      {{ request.email ?? '—' }} · {{ timeOf(request.closedAt, false) }}
                    </p>
                  </div>
                  <button
                    type="button"
                    appButton="secondary"
                    [compact]="true"
                    [attr.aria-describedby]="nameId('handled', request.id)"
                    [disabled]="store.busy().has(request.id)"
                    (click)="store.dismiss(request)"
                  >
                    知道了
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewMembers {
  /** The family's id, from the address. */
  readonly familyId = input.required<string>();

  protected readonly store = inject(NewMembersStore);

  constructor() {
    followFamily(this.familyId, this.store);
  }

  /** The id of the applicant's name in a row, which the row's buttons are described by. */
  protected nameId(list: RequestList, requestId: string): string {
    return `app-new-members-${list}-${requestId}`;
  }

  protected result(request: HandledJoinRequest): { label: string; tone: ChipTone } {
    return RESULTS[request.status];
  }

  /** A time in the family's time zone, with the time of day for a waiting request. */
  protected timeOf(moment: string, withTime: boolean): string {
    return formatDate(moment, this.store.family()?.timezone ?? 'UTC', { withTime });
  }
}
