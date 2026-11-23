import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { formatDate } from '../../shared/ui/dates';
import { LineIcon } from '../../shared/ui/line-icon';
import { FamilyStore } from './family-store';

/**
 * 等你处理 on the admin's family page (rules.md, 等你处理（管理员）): a row
 * for each join request waiting, newest first, with the applicant's avatar,
 * name, email (— when there is none) and the day they asked in the family's
 * time zone, then 拒绝 and 同意. From 640 px the email and the day share a
 * line and the buttons end the row; on a phone each has its own line and
 * the two buttons share the row under the applicant.
 *
 * A decided row slides out to the right while its height closes; nothing
 * else is said. A row's buttons wait while its request is being decided.
 * The family page shows the card only to the admin, and only while
 * requests wait.
 */
@Component({
  selector: 'app-family-requests',
  imports: [Avatar, Button, Card, LineIcon],
  host: { class: 'block' },
  template: `
    <section appCard>
      <h2 class="text-xl font-black">等你处理</h2>
      <ul class="mt-4 divide-y divide-line">
        @for (request of store.requests(); track request.id) {
          <li
            class="flex flex-wrap items-center gap-3 overflow-hidden py-4 first:pt-0 last:pb-0"
            [class.animate-slide-away]="store.isLeaving(request.id)"
          >
            <app-avatar [name]="request.name" [personId]="request.parentId" size="list" />
            <div class="min-w-0 flex-1">
              <p [id]="nameId(request.id)" class="font-bold">{{ request.name }}</p>
              <p class="text-sm text-ink-soft sm:truncate">
                <span class="block truncate sm:inline">{{ request.email ?? '—' }}</span><span
                  class="hidden sm:inline"
                >
                  · </span
                ><span class="block sm:inline">{{ dayOf(request.createdAt) }}申请</span>
              </p>
            </div>
            <div class="flex w-full gap-2 sm:w-auto">
              <button
                type="button"
                appButton="text"
                class="flex-1 border border-line sm:flex-none"
                [attr.aria-describedby]="nameId(request.id)"
                [disabled]="store.decidingRequests().has(request.id)"
                (click)="store.decide(request, 'reject')"
              >
                拒绝
              </button>
              <button
                type="button"
                appButton
                [compact]="true"
                class="flex-1 sm:flex-none"
                [attr.aria-describedby]="nameId(request.id)"
                [disabled]="store.decidingRequests().has(request.id)"
                (click)="store.decide(request, 'approve')"
              >
                <app-line-icon name="check" />同意
              </button>
            </div>
          </li>
        }
      </ul>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyRequests {
  protected readonly store = inject(FamilyStore);

  /** The id of the applicant's name in a row, which the row's buttons are described by. */
  protected nameId(requestId: string): string {
    return `app-family-request-${requestId}`;
  }

  /** The day a request was sent, in the family's time zone. */
  protected dayOf(moment: string): string {
    return formatDate(moment, this.store.family()?.timezone ?? 'UTC');
  }
}
