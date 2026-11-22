import { ChangeDetectionStrategy, Component, inject, input, linkedSignal } from '@angular/core';
import { whenBackInFront } from '../../core/connectivity';
import { JoinFamilyDialog } from '../../core/join-family-dialog';
import { JoinRequests } from '../../core/join-requests';
import { MyRequests } from '../../core/my-requests';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { PageProblem } from '../../shared/ui/page-problem';

/**
 * The join page at `/join` for a signed-in parent with a family (rules.md,
 * 我的申请): 申请加入家庭, which opens the join dialog, and the parent's own
 * requests to join families, or 还没有发出过申请. An invitation link
 * `/join/<code>` shows this page under the join dialog, filled with the
 * link's code; closing the dialog goes back to `/join`. The requests are read
 * again whenever the window comes back to the front.
 */
@Component({
  selector: 'app-join',
  imports: [Art, Button, JoinFamilyDialog, MyRequests, PageProblem],
  template: `
    @if (store.failure(); as failure) {
      <app-page-problem kind="server" [requestId]="failure.requestId" (action)="reload()" />
    } @else {
      <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
        <header class="flex flex-col gap-1">
          <h1 class="text-3xl font-black">加入家庭</h1>
        </header>
        <div>
          <button type="button" appButton class="w-full sm:w-auto" (click)="joining.set(true)">
            <img alt="" appArt="letter" class="size-6" />申请加入家庭
          </button>
        </div>
        @if (store.requests() !== null) {
          <app-my-requests [showEmpty]="true" />
        }
      </div>
    }
    <app-join-family-dialog
      [open]="joining()"
      [code]="code()"
      [leaveTo]="code() === undefined ? undefined : '/join'"
      (closed)="joining.set(false)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Join {
  /** The family code of an invitation link, from the address `/join/<code>`. */
  readonly code = input<string>();

  protected readonly store = inject(JoinRequests);
  protected readonly joining = linkedSignal(() => this.code() !== undefined);

  constructor() {
    void this.reload();
    whenBackInFront(() => void this.reload());
  }

  protected reload(): Promise<void> {
    return this.store.load();
  }
}
