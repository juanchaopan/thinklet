import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { Child } from '@thinklet/contracts';
import { FamilyTroubleView, followFamily } from '../../core/family-pages';
import { Art } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { Button, IconButton } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { ToolButton } from '../../shared/ui/tool-button';
import { ChildDevicesDialog } from './child-devices-dialog';
import { ChildFormDialog } from './child-form-dialog';
import { ChildQrDialog } from './child-qr-dialog';
import { ChildrenStore } from './children-store';

/** What is open for a child, or for adding one. */
type ChildDialog = 'add' | 'edit' | 'qr' | 'devices' | 'reset' | 'delete';

/**
 * The children page at `/families/:familyId/children` (rules.md, 孩子页):
 * 孩子 under the family's name, 添加孩子, and the children in the order they
 * were added, each with the avatar, the nickname and 账号 <account>, the QR
 * button (显示登录二维码) and the button of the child's actions (更多操作):
 * 改昵称和账号, 记住的设备, 重设密码 and 删除, each opening its dialog, the last
 * two asking first. With a mouse the actions drop down from the button; on a
 * touch screen they rise in a sheet headed by the child. Without children it
 * says 还没有孩子 with 添加孩子 in the card. Every parent of the family sees
 * the same page.
 *
 * The children are read again whenever the window comes back to the front.
 * A family the parent is not in says 找不到这个家庭. The QR code's library is
 * loaded when a QR code is first shown (decision 0032).
 */
@Component({
  selector: 'app-children-page',
  providers: [ChildrenStore],
  imports: [
    Art,
    Avatar,
    Button,
    Card,
    ChildDevicesDialog,
    ChildFormDialog,
    ChildQrDialog,
    ConfirmDialog,
    FamilyTroubleView,
    IconButton,
    LineIcon,
    Menu,
    MenuItem,
    ToolButton,
  ],
  template: `
    @if (store.problem(); as trouble) {
      <app-family-trouble [trouble]="trouble" (retry)="store.load()" />
    } @else if (store.children(); as children) {
      <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
        <header class="flex flex-col gap-1">
          <p class="text-sm font-bold text-ink-muted">{{ store.family()?.name }}</p>
          <h1 class="text-3xl font-black">孩子</h1>
        </header>
        @if (children.length > 0) {
          <div>
            <button type="button" appButton class="w-full sm:w-auto" (click)="add()">
              <img alt="" appArt="child" class="size-6" />添加孩子
            </button>
          </div>
          <section appCard>
            <ul class="divide-y divide-line">
              @for (child of children; track child.id) {
                <li class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <app-avatar [name]="child.nickname" [personId]="child.id" size="list" />
                  <div class="min-w-0 flex-1">
                    <p [id]="nameId(child)" class="font-bold">{{ child.nickname }}</p>
                    <p class="truncate text-sm text-ink-soft">账号 {{ child.account }}</p>
                  </div>
                  <app-tool-button
                    label="显示登录二维码"
                    [describedBy]="nameId(child)"
                    (click)="openFor('qr', child)"
                  >
                    <app-line-icon name="qr" />
                  </app-tool-button>
                  <button
                    #actions
                    type="button"
                    appIconButton
                    aria-haspopup="menu"
                    aria-label="更多操作"
                    [attr.aria-describedby]="nameId(child)"
                    [attr.aria-expanded]="menuFor() === child.id"
                    [class.bg-canvas]="menuFor() === child.id"
                    (click)="menuFor.set(child.id)"
                  >
                    <app-line-icon name="more" />
                  </button>
                  <app-menu
                    class="contents"
                    [open]="menuFor() === child.id"
                    [label]="child.nickname + '的操作'"
                    [origin]="actions"
                    [dropDown]="!inputMode.touch()"
                    align="end"
                    width="medium"
                    (dismissed)="menuFor.set(null)"
                  >
                    @if (inputMode.touch()) {
                      <div aria-hidden="true" class="flex items-center gap-3 px-3 py-3">
                        <app-avatar [name]="child.nickname" [personId]="child.id" size="large" />
                        <p class="font-bold">{{ child.nickname }}</p>
                      </div>
                      <div role="separator" class="my-1 border-t border-line"></div>
                    }
                    <button type="button" appMenuItem (click)="openFor('edit', child)">
                      <img alt="" appArt="consent" class="size-7" />
                      <span class="font-bold">改昵称和账号</span>
                    </button>
                    <button type="button" appMenuItem (click)="openFor('devices', child)">
                      <img alt="" appArt="hourglass" class="size-7" />
                      <span class="font-bold">记住的设备</span>
                    </button>
                    <button type="button" appMenuItem (click)="openFor('reset', child)">
                      <img alt="" appArt="key" class="size-7" />
                      <span class="font-bold">重设密码</span>
                    </button>
                    <button
                      type="button"
                      appMenuItem
                      class="text-rose-ink"
                      (click)="openFor('delete', child)"
                    >
                      <img alt="" appArt="door" class="size-7" />
                      <span class="font-bold">删除</span>
                    </button>
                  </app-menu>
                </li>
              }
            </ul>
          </section>
        } @else {
          <section appCard>
            <div class="flex flex-col items-center gap-2 py-8 text-center">
              <img alt="" appArt="seedling" class="size-16" />
              <h2 class="mt-2 text-lg font-black">还没有孩子</h2>
              <p class="text-sm text-ink-soft">添加孩子后，孩子就能用自己的账号登录。</p>
              <button type="button" appButton class="mt-4" (click)="add()">
                <img alt="" appArt="child" class="size-6" />添加孩子
              </button>
            </div>
          </section>
        }
      </div>
    }
    <app-child-form-dialog
      [open]="dialog() === 'add' || dialog() === 'edit'"
      [child]="formChild()"
      (closed)="close()"
    />
    @if (asked(); as child) {
      @defer (when dialog() === 'qr') {
        <app-child-qr-dialog [open]="dialog() === 'qr'" [child]="child" (closed)="close()" />
      }
      <app-child-devices-dialog
        [open]="dialog() === 'devices'"
        [child]="child"
        (closed)="close()"
      />
      <app-confirm-dialog
        [open]="dialog() === 'reset'"
        icon="key"
        [title]="'重设' + child.nickname + '的密码？'"
        [text]="
          '旧密码马上不能用，已经登录的设备会退出，记住的设备也会一起撤销。' +
          child.nickname +
          '下次扫登录二维码时设新密码。'
        "
        action="重设"
        [busy]="store.busy() === 'reset'"
        (confirmed)="resetPassword(child)"
        (dismissed)="close()"
      />
      <app-confirm-dialog
        [open]="dialog() === 'delete'"
        icon="door"
        [title]="'删除' + child.nickname + '？'"
        [text]="child.nickname + '的账号、记住的设备和同意记录都会删掉，不能恢复。'"
        action="删除"
        [danger]="true"
        [busy]="store.busy() === 'delete'"
        (confirmed)="remove(child)"
        (dismissed)="close()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildrenPage {
  /** The family's id, from the address. */
  readonly familyId = input.required<string>();

  protected readonly store = inject(ChildrenStore);
  protected readonly inputMode = inject(InputMode);

  /** The child whose actions are open. */
  protected readonly menuFor = signal<string | null>(null);
  /** What is open now. */
  protected readonly dialog = signal<ChildDialog | null>(null);
  /**
   * The child last asked about. It stays after the dialog closes, so the
   * dialog keeps its words while it leaves.
   */
  protected readonly asked = signal<Child | null>(null);
  /**
   * The child the form changes, none while it adds a child. It stays after
   * the form closes, so the form keeps its title while it leaves.
   */
  protected readonly formChild = signal<Child | null>(null);

  constructor() {
    followFamily(this.familyId, this.store);
  }

  /** The id of a child's nickname, which the row's buttons are described by. */
  protected nameId(child: Child): string {
    return `app-children-${child.id}`;
  }

  protected add(): void {
    this.formChild.set(null);
    this.dialog.set('add');
  }

  protected openFor(dialog: ChildDialog, child: Child): void {
    this.menuFor.set(null);
    this.asked.set(child);
    if (dialog === 'edit') {
      this.formChild.set(child);
    }
    this.dialog.set(dialog);
  }

  protected close(): void {
    this.dialog.set(null);
  }

  /** Resets the password once confirmed; the question closes whatever the outcome. */
  protected async resetPassword(child: Child): Promise<void> {
    await this.store.resetPassword(child);
    this.close();
  }

  /** Deletes the child once confirmed; the question closes whatever the outcome. */
  protected async remove(child: Child): Promise<void> {
    await this.store.remove(child);
    this.close();
  }
}
