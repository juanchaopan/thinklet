import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import type { MeFamily } from '@thinklet/contracts';
import { whenBackInFront } from '../../core/connectivity';
import { CurrentFamily } from '../../core/current-family';
import { FamilyCreation } from '../../core/family-creation';
import { JoinFamilyDialog } from '../../core/join-family-dialog';
import { JoinRequests } from '../../core/join-requests';
import { MyRequests } from '../../core/my-requests';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { LineIcon } from '../../shared/ui/line-icon';
import { PageProblem } from '../../shared/ui/page-problem';
import { Toaster } from '../../shared/ui/toast';

/**
 * The start page at `/start` for a signed-in parent without a family: a
 * welcome, the parent's own requests to join families when there are any,
 * and the two ways to a family, creating one or asking to join one. An
 * invitation link `/join/<code>` shows this page under the join dialog,
 * filled with the link's code; closing the dialog goes back to `/start`.
 *
 * The requests are read again whenever the window comes back to the front.
 * When the parent turns out to have joined a family meanwhile (a request was
 * approved), that family's home page opens with 你已加入「<name>」. A family
 * the parent creates here is theirs to run, so only a family they are a
 * member of counts as joined.
 */
@Component({
  selector: 'app-start',
  imports: [Art, JoinFamilyDialog, LineIcon, MyRequests, PageProblem],
  host: { class: 'flex flex-1 flex-col' },
  template: `
    @if (store.failure(); as failure) {
      <app-page-problem kind="server" [requestId]="failure.requestId" (action)="reload()" />
    } @else {
      <div class="mx-auto flex w-full max-w-xl flex-1 stagger flex-col justify-center gap-5 py-6">
        <header>
          <h1 class="text-3xl font-black">欢迎，{{ session.me()?.name }}</h1>
          @if (!hasRequests()) {
            <p class="mt-2 text-base text-ink-soft">先创建或加入一个家庭。</p>
          }
        </header>
        @if (hasRequests()) {
          <app-my-requests />
        }
        <div class="flex flex-col gap-3">
          <button type="button" [class]="choice" (click)="creation.request()">
            <img alt="" appArt="seedling" class="size-12" />
            <span class="min-w-0 flex-1">
              <span class="block text-lg font-black">创建家庭</span>
              <span class="mt-0.5 block text-sm text-ink-soft">你来当管理员</span>
            </span>
            <app-line-icon name="forward" class="text-ink-muted" />
          </button>
          <button type="button" [class]="choice" (click)="joining.set(true)">
            <img alt="" appArt="letter" class="size-12" />
            <span class="min-w-0 flex-1">
              <span class="block text-lg font-black">申请加入家庭</span>
              <span class="mt-0.5 block text-sm text-ink-soft">用家人给的家庭码</span>
            </span>
            <app-line-icon name="forward" class="text-ink-muted" />
          </button>
        </div>
      </div>
    }
    <app-join-family-dialog
      [open]="joining()"
      [code]="code()"
      [leaveTo]="code() === undefined ? undefined : '/start'"
      (closed)="joining.set(false)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Start {
  /** The family code of an invitation link, from the address `/join/<code>`. */
  readonly code = input<string>();

  protected readonly session = inject(Session);
  protected readonly creation = inject(FamilyCreation);
  protected readonly store = inject(JoinRequests);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);

  protected readonly joining = linkedSignal(() => this.code() !== undefined);
  protected readonly hasRequests = computed(() => (this.store.requests()?.length ?? 0) > 0);

  /** A card that leads on: lifts slightly under the mouse and shrinks a little while pressed. */
  protected readonly choice =
    'flex w-full items-center gap-4 rounded-card border border-line bg-surface p-5 text-left shadow-card transition duration-150 ease-move hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-pop active:scale-99';

  private entered = false;

  constructor() {
    void this.reload();
    whenBackInFront(() => void this.reload());
    effect(() => {
      const joined = this.session.me()?.families.find((family) => family.role === 'member');
      if (joined) {
        untracked(() => this.enter(joined));
      }
    });
  }

  protected reload(): Promise<void> {
    return this.store.load();
  }

  /** Opens the home page of the family the parent has joined, once. */
  private enter(family: MeFamily): void {
    if (this.entered) {
      return;
    }
    this.entered = true;
    this.currentFamily.select(family.id);
    void this.router.navigateByUrl('/');
    this.toaster.show(`你已加入「${family.name}」`, 'success', 'party');
  }
}
