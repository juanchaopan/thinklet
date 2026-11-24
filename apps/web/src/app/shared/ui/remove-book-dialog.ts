import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ConfirmDialog } from './confirm-dialog';

/**
 * The question asked before a book leaves the family's books (rules.md,
 * 移除), from a library card and from the book's page alike: 从我家的书里移除
 * 《<title>》？, that the book can be acquired again while it is in the
 * library, 取消 and the red 移除. The title makes the question long, so the
 * dialog is a wide one. While the book is removed (`busy`) 移除 says
 * 处理中….
 */
@Component({
  selector: 'app-remove-book-dialog',
  imports: [ConfirmDialog],
  template: `
    <app-confirm-dialog
      [open]="open()"
      icon="door"
      [title]="'从我家的书里移除《' + title() + '》？'"
      text="这本书还在书库里时，可以再获取。"
      action="移除"
      [danger]="true"
      size="large"
      [busy]="busy()"
      (confirmed)="confirmed.emit()"
      (dismissed)="dismissed.emit()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RemoveBookDialog {
  readonly open = input.required<boolean>();
  /** The book's title. */
  readonly title = input.required<string>();
  readonly busy = input(false);

  readonly confirmed = output();
  readonly dismissed = output();
}
