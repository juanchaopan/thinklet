import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { Child, ChildDevice } from '@thinklet/contracts';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { formatDate } from '../../shared/ui/dates';
import { Dialog } from '../../shared/ui/dialog';
import { LineIcon } from '../../shared/ui/line-icon';
import { ChildrenStore } from './children-store';

/** A revoked row slides out in 250 ms (look.md, 动画), and then leaves the list. */
const SLIDE_AWAY_DURATION = 250;

/**
 * The devices a child is remembered on (rules.md, 记住的设备): <昵称>记住的设备,
 * one row per device, latest login first, with the device's name, 记住于
 * <day> · 最近登录 <day and time> in the family's time zone, and 撤销; 全部撤销
 * under them. Without devices it says 还没有记住的设备 and how a device gets
 * there.
 *
 * 撤销 asks nothing: the row slides out to the right while its height closes,
 * and nothing more is said. 全部撤销 asks first, in a dialog over this one,
 * and says 已全部撤销. Devices that cannot be read, or a child deleted
 * meanwhile, close the dialog once that has been said.
 */
@Component({
  selector: 'app-child-devices-dialog',
  imports: [Art, Button, ConfirmDialog, Dialog, LineIcon],
  template: `
    <app-dialog
      [open]="open()"
      [title]="child().nickname + '记住的设备'"
      size="large"
      [closable]="true"
      (dismissed)="closed.emit()"
    >
      @if (devices(); as devices) {
        @if (devices.length > 0) {
          <ul class="mt-4 divide-y divide-line">
            @for (device of devices; track device.id) {
              <li
                class="flex items-center gap-3 overflow-hidden py-3"
                [class.animate-slide-away]="leaving().has(device.id)"
              >
                <span
                  class="flex size-11 shrink-0 items-center justify-center rounded-full bg-canvas text-primary"
                >
                  <app-line-icon name="device" />
                </span>
                <div class="min-w-0 flex-1">
                  <p [id]="nameId(device)" class="font-bold">{{ device.name }}</p>
                  <p class="text-sm text-ink-soft">
                    <span class="whitespace-nowrap">记住于 {{ dateOf(device.rememberedAt) }}</span>
                    ·
                    <span class="whitespace-nowrap"
                      >最近登录 {{ dateOf(device.lastUsedAt, true) }}</span
                    >
                  </p>
                </div>
                <button
                  type="button"
                  appButton="secondary"
                  [compact]="true"
                  [attr.aria-describedby]="nameId(device)"
                  [disabled]="revoking().has(device.id)"
                  (click)="revoke(device)"
                >
                  撤销
                </button>
              </li>
            }
          </ul>
          <div class="mt-4 flex justify-end">
            <button
              type="button"
              appButton="secondary"
              [compact]="true"
              class="w-full sm:w-auto"
              (click)="confirming.set(true)"
            >
              全部撤销
            </button>
          </div>
        } @else {
          <div class="mt-4 flex flex-col items-center gap-2 py-6 text-center">
            <img alt="" appArt="hourglass" class="size-14" />
            <p class="font-bold">还没有记住的设备</p>
            <p class="text-sm text-ink-soft">
              孩子登录时勾选「在这台设备上记住我」，这台设备就会出现在这里。
            </p>
          </div>
        }
      }
    </app-dialog>
    <app-confirm-dialog
      [open]="confirming()"
      icon="hourglass"
      [title]="'撤销' + child().nickname + '的全部设备？'"
      text="这些设备上点头像不能再直接登录，要重新输入密码。"
      action="全部撤销"
      [busy]="store.busy() === 'revoke-all'"
      (confirmed)="revokeAll()"
      (dismissed)="confirming.set(false)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildDevicesDialog {
  readonly open = input.required<boolean>();
  readonly child = input.required<Child>();

  readonly closed = output();

  protected readonly store = inject(ChildrenStore);

  /** The child's devices; null while they are being read. */
  protected readonly devices = signal<readonly ChildDevice[] | null>(null);
  /** The devices whose rows are sliding out. */
  protected readonly leaving = signal<ReadonlySet<string>>(new Set());
  /** The devices being revoked right now. */
  protected readonly revoking = signal<ReadonlySet<string>>(new Set());
  protected readonly confirming = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => void this.load());
      }
    });
  }

  /** The id of a device's name, which the row's 撤销 is described by. */
  protected nameId(device: ChildDevice): string {
    return `app-child-device-${device.id}`;
  }

  /** A day in the family's time zone, with the time of day for the latest login. */
  protected dateOf(moment: string, withTime = false): string {
    return formatDate(moment, this.store.family()?.timezone ?? 'UTC', { withTime });
  }

  /** Revokes the device; its row slides out and leaves the list. */
  protected async revoke(device: ChildDevice): Promise<void> {
    if (this.revoking().has(device.id)) {
      return;
    }
    this.revoking.update((ids) => new Set([...ids, device.id]));
    const outcome = await this.store.revokeDevice(this.child(), device);
    this.revoking.update((ids) => new Set([...ids].filter((id) => id !== device.id)));
    if (outcome === 'gone') {
      this.closed.emit();
    } else if (outcome === 'done') {
      this.slideOut(device.id);
    }
  }

  /** Revokes every device once confirmed; the question closes whatever the outcome. */
  protected async revokeAll(): Promise<void> {
    const outcome = await this.store.revokeAllDevices(this.child());
    this.confirming.set(false);
    if (outcome === 'gone') {
      this.closed.emit();
    } else if (outcome === 'done') {
      this.devices.set([]);
      this.leaving.set(new Set());
    }
  }

  /** Reads the devices afresh; when they cannot be read the dialog closes. */
  private async load(): Promise<void> {
    this.devices.set(null);
    this.leaving.set(new Set());
    this.confirming.set(false);
    const devices = await this.store.devices(this.child());
    if (typeof devices === 'string') {
      this.closed.emit();
      return;
    }
    this.devices.set(devices);
  }

  private slideOut(deviceId: string): void {
    this.leaving.update((ids) => new Set([...ids, deviceId]));
    setTimeout(() => {
      this.leaving.update((ids) => new Set([...ids].filter((id) => id !== deviceId)));
      this.devices.update((devices) => devices?.filter(({ id }) => id !== deviceId) ?? null);
    }, SLIDE_AWAY_DURATION);
  }
}
