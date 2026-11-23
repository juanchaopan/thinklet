import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { FamilyMember } from '@thinklet/contracts';
import { Art } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { IconButton } from '../../shared/ui/button';
import { Card, Chip } from '../../shared/ui/card';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { FamilyStore } from './family-store';

/** What the admin is asked to confirm for a member. */
type MemberAction = 'admin' | 'remove';

/**
 * 家庭成员: the family's parents in the order they joined, each with the
 * avatar, the name, （你） for the parent looking, the 管理员 tag and the
 * email (— when there is none). The admin opens each other member's actions
 * with the button at the end of the row: 设为管理员 and 移出家庭, each
 * confirmed first. With a mouse they drop down from the button; on a touch
 * screen they rise in a sheet headed by the member.
 */
@Component({
  selector: 'app-family-members',
  imports: [Art, Avatar, Card, Chip, ConfirmDialog, IconButton, LineIcon, Menu, MenuItem],
  host: { class: 'block' },
  template: `
    @if (store.family(); as family) {
      <section appCard>
        <h2 class="text-xl font-black">家庭成员</h2>
        <p class="mt-4 text-sm font-bold text-ink-muted">家长 · {{ family.members.length }}</p>
        <ul class="mt-1 divide-y divide-line">
          @for (member of family.members; track member.parentId) {
            <li class="flex items-center gap-3 py-3">
              <app-avatar [name]="member.name" [personId]="member.parentId" size="list" />
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2 font-bold">
                  {{ member.name }}
                  @if (member.you) {
                    <span class="text-sm font-normal text-ink-muted">（你）</span>
                  }
                  @if (member.role === 'admin') {
                    <span appChip="sun"><img alt="" appArt="crown" class="size-4" />管理员</span>
                  }
                </p>
                <p class="truncate text-sm text-ink-soft">{{ member.email ?? '—' }}</p>
              </div>
              @if (store.admin() && !member.you) {
                <button
                  #actions
                  type="button"
                  appIconButton
                  aria-haspopup="menu"
                  [attr.aria-label]="member.name + '的操作'"
                  [attr.aria-expanded]="menuFor() === member.parentId"
                  [class.bg-canvas]="menuFor() === member.parentId"
                  (click)="menuFor.set(member.parentId)"
                >
                  <app-line-icon name="more" />
                </button>
                <app-menu
                  class="contents"
                  [open]="menuFor() === member.parentId"
                  [label]="member.name + '的操作'"
                  [origin]="actions"
                  [dropDown]="!inputMode.touch()"
                  align="end"
                  width="narrow"
                  (dismissed)="menuFor.set(null)"
                >
                  @if (inputMode.touch()) {
                    <div aria-hidden="true" class="flex items-center gap-3 px-3 py-3">
                      <app-avatar [name]="member.name" [personId]="member.parentId" size="large" />
                      <p class="font-bold">{{ member.name }}</p>
                    </div>
                    <div role="separator" class="my-1 border-t border-line"></div>
                  }
                  <button type="button" appMenuItem (click)="ask('admin', member)">
                    <img alt="" appArt="crown" class="size-7" />
                    <span class="font-bold">设为管理员</span>
                  </button>
                  <button
                    type="button"
                    appMenuItem
                    class="text-rose-ink"
                    (click)="ask('remove', member)"
                  >
                    <img alt="" appArt="door" class="size-7" />
                    <span class="font-bold">移出家庭</span>
                  </button>
                </app-menu>
              }
            </li>
          }
        </ul>
      </section>
    }
    <app-confirm-dialog
      [open]="asking() === 'admin'"
      icon="crown"
      [title]="'让' + askedName() + '当管理员？'"
      text="你将变成普通家长。"
      action="确定"
      [busy]="store.busy() === 'admin'"
      (confirmed)="confirm()"
      (dismissed)="asking.set(null)"
    />
    <app-confirm-dialog
      [open]="asking() === 'remove'"
      icon="door"
      [title]="'把' + askedName() + '移出家庭？'"
      [text]="'移出后，' + askedName() + '就看不到这个家庭了。'"
      action="移出"
      [danger]="true"
      [busy]="store.busy() === 'remove'"
      (confirmed)="confirm()"
      (dismissed)="asking.set(null)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyMembers {
  protected readonly store = inject(FamilyStore);
  protected readonly inputMode = inject(InputMode);

  /** The member whose actions are open. */
  protected readonly menuFor = signal<string | null>(null);
  /** What the admin is asked to confirm now. */
  protected readonly asking = signal<MemberAction | null>(null);
  /**
   * The member last asked about. It stays after the question closes, so the
   * dialog keeps its words while it leaves.
   */
  private readonly asked = signal<FamilyMember | null>(null);

  protected readonly askedName = computed(() => this.asked()?.name ?? '');

  protected ask(action: MemberAction, member: FamilyMember): void {
    this.menuFor.set(null);
    this.asked.set(member);
    this.asking.set(action);
  }

  /** Carries out what was confirmed; the question closes whatever the outcome. */
  protected async confirm(): Promise<void> {
    const member = this.asked();
    if (!member) {
      return;
    }
    if (this.asking() === 'admin') {
      await this.store.makeAdmin(member);
    } else {
      await this.store.remove(member);
    }
    this.asking.set(null);
  }
}
