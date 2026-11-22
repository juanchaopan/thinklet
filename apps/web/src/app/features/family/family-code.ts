import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Session } from '../../core/session';
import { Button } from '../../shared/ui/button';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { LineIcon } from '../../shared/ui/line-icon';
import { Toaster } from '../../shared/ui/toast';
import { ToolButton } from '../../shared/ui/tool-button';
import { FamilyStore } from './family-store';
import { invitationLink, invitationText, ShareSheet } from './invitation';
import { QrDialog } from './qr-dialog';

/**
 * The family code and the ways to pass it on (rules.md, 分享家庭码): copying
 * the code, sharing the invitation through the system's share sheet (or
 * copying the invitation where there is none), and showing the invitation
 * link as a QR code. The admin also replaces the code with 更换家庭码, after
 * confirming. The QR code's library is loaded when the QR code is first
 * shown (decision 0032).
 */
@Component({
  selector: 'app-family-code',
  imports: [Button, ConfirmDialog, LineIcon, QrDialog, ToolButton],
  template: `
    @if (store.family(); as family) {
      <div class="flex flex-wrap items-center gap-2">
        <p class="font-mono text-3xl font-black tracking-[0.25em]">{{ family.code }}</p>
        <div class="flex gap-2">
          <app-tool-button label="复制家庭码" (click)="copy(family.code)">
            <app-line-icon name="copy" />
          </app-tool-button>
          <app-tool-button label="分享邀请" (click)="share()">
            <app-line-icon name="share" />
          </app-tool-button>
          <app-tool-button label="显示二维码" (click)="showingCode.set(true)">
            <app-line-icon name="qr" />
          </app-tool-button>
        </div>
        @if (store.admin()) {
          <button
            type="button"
            appButton="text"
            class="border border-line"
            (click)="confirming.set(true)"
          >
            更换家庭码
          </button>
        }
      </div>
      <app-confirm-dialog
        [open]="confirming()"
        icon="key"
        title="更换家庭码？"
        text="旧码会失效，用旧码发的申请也会作废。"
        action="更换"
        [danger]="true"
        [busy]="store.busy() === 'code'"
        (confirmed)="changeCode()"
        (dismissed)="confirming.set(false)"
      />
      @defer (when showingCode()) {
        <app-qr-dialog
          [open]="showingCode()"
          [familyName]="family.name"
          [code]="family.code"
          [link]="link()"
          (dismissed)="showingCode.set(false)"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyCode {
  protected readonly store = inject(FamilyStore);
  protected readonly showingCode = signal(false);
  protected readonly confirming = signal(false);

  private readonly session = inject(Session);
  private readonly clipboard = inject(Clipboard);
  private readonly shareSheet = inject(ShareSheet);
  private readonly toaster = inject(Toaster);
  private readonly origin = inject(DOCUMENT).location.origin;

  protected readonly link = computed(() =>
    invitationLink(this.origin, this.store.family()?.code ?? ''),
  );

  /** Copies the text and says 已复制. */
  protected copy(text: string): void {
    if (this.clipboard.copy(text)) {
      this.toaster.show('已复制', 'success', 'key');
    } else {
      this.toaster.show('出了点问题，请稍后再试', 'error', 'wrench');
    }
  }

  /**
   * Shares the invitation through the share sheet; closing the sheet
   * without sharing does nothing more. Without a share sheet, or when it
   * fails, the invitation is copied instead.
   */
  protected async share(): Promise<void> {
    const family = this.store.family();
    if (!family) {
      return;
    }
    const name = this.session.me()?.name ?? '';
    const text = invitationText(name, family.name, family.code, this.link());
    if (!this.shareSheet.canShare(text)) {
      this.copy(text);
      return;
    }
    try {
      await this.shareSheet.share(text);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.copy(text);
      }
    }
  }

  protected async changeCode(): Promise<void> {
    await this.store.changeCode();
    this.confirming.set(false);
  }
}
