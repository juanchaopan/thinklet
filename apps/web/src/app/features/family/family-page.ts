import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FamilyTroubleView, followFamily } from '../../core/family-pages';
import { Card } from '../../shared/ui/card';
import { FamilyCode } from './family-code';
import { FamilyMembers } from './family-members';
import { FamilyName } from './family-name';
import { FamilyRequests } from './family-requests';
import { FamilyStore } from './family-store';
import { FamilyTimeZone } from './family-time-zone';
import { InfoRow } from './info-row';
import { LeaveFamily } from './leave-family';

/**
 * The family page at `/families/:familyId` (rules.md, 家庭 and 等你处理
 * （管理员）; README of the design, 家庭管理): the family's name, its code
 * with the ways to pass it on, its time zone, the join requests waiting for
 * the admin, its members and 离开家庭. Every parent of the family sees the
 * same page; only the admin sees the pencils, the actions and, while any
 * wait, the requests, between the family's card and its members.
 *
 * A family the parent is not a member of says 找不到这个家庭; a page the
 * server could not open says so with the error number. The family and its
 * requests are read again whenever the window comes back to the front, so a
 * code changed elsewhere shows, in the QR code too, and so do new requests.
 */
@Component({
  selector: 'app-family-page',
  providers: [FamilyStore],
  imports: [
    Card,
    FamilyCode,
    FamilyMembers,
    FamilyName,
    FamilyRequests,
    FamilyTimeZone,
    FamilyTroubleView,
    InfoRow,
    LeaveFamily,
  ],
  template: `
    @if (store.problem(); as trouble) {
      <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
    } @else if (store.family()) {
      <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
        <app-family-name />
        <section appCard>
          <div class="divide-y divide-line">
            <app-info-row icon="key" label="家庭码"><app-family-code /></app-info-row>
            <app-info-row icon="globe" label="时区"><app-family-time-zone /></app-info-row>
          </div>
        </section>
        @if (store.admin() && store.requests().length > 0) {
          <app-family-requests />
        }
        <app-family-members />
        <app-leave-family />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyPage {
  /** The family's id, from the address. */
  readonly familyId = input.required<string>();

  protected readonly store = inject(FamilyStore);

  constructor() {
    followFamily(this.familyId, this.store);
  }
}
