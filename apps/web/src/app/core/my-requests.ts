import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { ApplicantJoinRequest } from '@thinklet/contracts';
import { Art, type IconArt } from '../shared/ui/art';
import { Button } from '../shared/ui/button';
import { Card, Chip, type ChipTone } from '../shared/ui/card';
import { formatDate } from '../shared/ui/dates';
import { JoinRequests } from './join-requests';

interface StatusLook {
  readonly label: string;
  readonly tone: ChipTone;
  readonly icon: IconArt;
  readonly action: string;
  readonly note?: string;
}

/** How each state of a request is shown, and the one action it allows (rules.md, 我的申请). */
const STATUSES: Record<ApplicantJoinRequest['status'], StatusLook> = {
  pending: { label: '等待中', tone: 'sun', icon: 'hourglass', action: '撤回' },
  approved: { label: '已同意', tone: 'mint', icon: 'letter', action: '知道了' },
  rejected: { label: '被拒绝', tone: 'rose', icon: 'letter', action: '知道了' },
  expired: {
    label: '已失效',
    tone: 'gray',
    icon: 'letter',
    action: '知道了',
    note: '家庭码已更换',
  },
};

let nextListId = 0;

/**
 * 我的申请: one card per request of the signed-in parent, newest first, with
 * the family, its admin, the day the request was sent in that family's time
 * zone, the state, and 撤回 for a waiting request or 知道了 for one with a
 * result. Without requests the section is left out, or says 还没有发出过申请
 * where `showEmpty` asks for it.
 */
@Component({
  selector: 'app-my-requests',
  imports: [Art, Button, Card, Chip],
  host: { class: 'block' },
  template: `
    @if (requests().length > 0 || showEmpty()) {
      <section class="flex flex-col gap-3" [attr.aria-labelledby]="headingId">
        <h2 [id]="headingId" class="text-lg font-black">我的申请</h2>
        @for (request of requests(); track request.id) {
          <div appCard>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
              <img alt="" [appArt]="look(request).icon" class="size-10" />
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2">
                  <span [id]="familyId(request)" class="text-lg font-black">{{
                    request.familyName
                  }}</span>
                  <span [appChip]="look(request).tone">{{ look(request).label }}</span>
                </p>
                <p class="mt-1 text-sm text-ink-soft">
                  管理员 {{ request.adminName }} · {{ sentOn(request) }}申请
                </p>
                @if (look(request).note; as note) {
                  <p class="mt-1 text-sm text-ink-muted">{{ note }}</p>
                }
              </div>
              <button
                type="button"
                appButton="secondary"
                [compact]="true"
                class="w-full sm:w-auto"
                [attr.aria-describedby]="familyId(request)"
                [disabled]="store.busy().has(request.id)"
                (click)="act(request)"
              >
                {{ look(request).action }}
              </button>
            </div>
          </div>
        } @empty {
          <div appCard>
            <div class="flex flex-col items-center gap-2 py-6 text-center">
              <img alt="" appArt="letter" class="size-14" />
              <p class="font-bold text-ink-soft">还没有发出过申请</p>
            </div>
          </div>
        }
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyRequests {
  /** Says 还没有发出过申请 when there are no requests, instead of leaving the section out. */
  readonly showEmpty = input(false);

  protected readonly store = inject(JoinRequests);
  protected readonly requests = computed(() => this.store.requests() ?? []);
  protected readonly headingId = `app-my-requests-${String(nextListId++)}`;

  protected look(request: ApplicantJoinRequest): StatusLook {
    return STATUSES[request.status];
  }

  protected familyId(request: ApplicantJoinRequest): string {
    return `${this.headingId}-${request.id}`;
  }

  protected sentOn(request: ApplicantJoinRequest): string {
    return formatDate(request.createdAt, request.familyTimezone);
  }

  protected act(request: ApplicantJoinRequest): void {
    void (request.status === 'pending'
      ? this.store.withdraw(request)
      : this.store.dismiss(request));
  }
}
