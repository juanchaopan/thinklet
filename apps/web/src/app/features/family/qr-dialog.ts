import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Dialog } from '../../shared/ui/dialog';
import { QrCode } from '../../shared/ui/qr-code';

/**
 * The invitation as a QR code (rules.md, 分享家庭码): 扫码加入「<family>」, the
 * QR code of the invitation link, which a phone's camera opens as the join
 * dialog with the code filled in, and the code itself under it for typing.
 * It only shows something, so it closes with its ×.
 */
@Component({
  selector: 'app-qr-dialog',
  imports: [Dialog, QrCode],
  template: `
    <app-dialog
      [open]="open()"
      [title]="'扫码加入「' + familyName() + '」'"
      [closable]="true"
      (dismissed)="dismissed.emit()"
    >
      <div class="mt-5 flex flex-col items-center gap-4">
        <div class="rounded-card border border-line p-2">
          <app-qr-code [text]="link()" label="邀请链接的二维码" />
        </div>
        <p class="text-center text-base text-ink-soft">
          也可以输入家庭码
          <span class="font-mono text-lg font-black tracking-[0.25em] text-ink">{{ code() }}</span>
        </p>
      </div>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrDialog {
  readonly open = input.required<boolean>();
  readonly familyName = input.required<string>();
  readonly code = input.required<string>();
  /** The invitation link the QR code holds. */
  readonly link = input.required<string>();

  readonly dismissed = output();
}
