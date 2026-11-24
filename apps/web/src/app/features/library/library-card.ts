import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { BookCard } from '@thinklet/contracts';
import { Art } from '../../shared/ui/art';
import { BookCover, BookTile } from '../../shared/ui/book-tile';
import { Button, IconButton, PRESS } from '../../shared/ui/button';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { ReaderAvatars, readersInWords } from '../../shared/ui/reader-avatars';

/**
 * A book of the library as the family sees it (rules.md, 书的卡片): the card
 * leads to the book's page, and its footer offers 获取 for a book the family
 * does not have, or says 已获取 with the avatars of the children who read
 * it, or the dashed plus while nobody does; pressing them asks for 谁能读. A
 * book the family has and nobody reads carries 更多操作 over its cover, with
 * 从我家的书里移除: with a mouse it drops down from the button, on a touch
 * screen it rises in a sheet headed by the book's small cover and title.
 * While the book is being acquired (`acquiring`) 获取 says 处理中… and cannot
 * be pressed again.
 *
 * Screen readers hear 管理谁能读《<title>》 for the avatars, described by who
 * reads the book, and the other buttons described by the title, so the many
 * 获取 of a page tell their books apart. The card only says what was
 * pressed.
 */
@Component({
  selector: 'app-library-card',
  imports: [Art, BookCover, BookTile, Button, IconButton, LineIcon, Menu, MenuItem, ReaderAvatars],
  host: { class: 'block' },
  template: `
    <app-book-tile class="h-full" [book]="book()" [link]="'/books/' + book().id">
      @if (removable()) {
        <span appBookTileCorner class="block">
          <button
            #actions
            type="button"
            appIconButton
            aria-haspopup="menu"
            aria-label="更多操作"
            class="shadow-card"
            [class]="menuOpen() ? 'bg-canvas' : 'bg-surface/90'"
            [attr.aria-describedby]="titleId()"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(true)"
          >
            <app-line-icon name="more" />
          </button>
          <app-menu
            class="contents"
            [open]="menuOpen()"
            [label]="'《' + book().title + '》的操作'"
            [origin]="actions"
            [dropDown]="!inputMode.touch()"
            align="end"
            width="roomy"
            (dismissed)="menuOpen.set(false)"
          >
            @if (inputMode.touch()) {
              <div aria-hidden="true" class="flex items-center gap-3 px-3 py-3">
                <app-book-cover
                  class="w-10 shrink-0 rounded-md ring-1 ring-line"
                  [coverUrl]="book().coverUrl"
                />
                <p class="min-w-0 flex-1 truncate font-bold">{{ book().title }}</p>
              </div>
              <div role="separator" class="my-1 border-t border-line"></div>
            }
            <button type="button" appMenuItem class="text-rose-ink" (click)="askToRemove()">
              <img alt="" appArt="door" class="size-7" />
              <span class="font-bold">从我家的书里移除</span>
            </button>
          </app-menu>
        </span>
      }
      @if (book().acquired) {
        <span
          class="inline-flex items-center gap-1 text-sm font-bold whitespace-nowrap text-mint-ink"
        >
          <app-line-icon name="tick" />已获取
        </span>
        <span class="-mr-1 ml-auto sm:-mr-1.5">
          <button
            type="button"
            class="relative z-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-1 hover:bg-canvas sm:px-1.5 {{
              press
            }}"
            [attr.aria-describedby]="readersId()"
            (click)="readers.emit()"
          >
            <app-reader-avatars [readers]="book().readers" />
            <span class="sr-only">管理谁能读《{{ book().title }}》</span>
          </button>
          <span [id]="readersId()" class="sr-only">{{ readersText() }}</span>
        </span>
      } @else if (book().status === 'active') {
        <button
          type="button"
          appButton
          class="relative z-1"
          [compact]="true"
          [attr.aria-describedby]="titleId()"
          [disabled]="acquiring()"
          (click)="acquire.emit()"
        >
          {{ acquiring() ? '处理中…' : '获取' }}
        </button>
      }
      <span [id]="titleId()" class="sr-only">《{{ book().title }}》</span>
    </app-book-tile>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryCard {
  readonly book = input.required<BookCard>();
  readonly acquiring = input(false);

  /** 获取 was pressed. */
  readonly acquire = output();
  /** The readers' avatars or the dashed plus were pressed, for 谁能读. */
  readonly readers = output();
  /** 从我家的书里移除 was chosen. */
  readonly remove = output();

  protected readonly inputMode = inject(InputMode);
  protected readonly press = PRESS;
  protected readonly menuOpen = signal(false);

  /** A book the family has and nobody reads can be removed from the family's books. */
  protected readonly removable = computed(
    () => this.book().acquired && this.book().readers.length === 0,
  );

  protected readonly titleId = computed(() => `app-library-title-${this.book().id}`);
  protected readonly readersId = computed(() => `app-library-readers-${this.book().id}`);

  /** Who reads the book, in words, as the avatars show it. */
  protected readonly readersText = computed(() =>
    readersInWords(this.book().readers, '还没有孩子在读'),
  );

  protected askToRemove(): void {
    this.menuOpen.set(false);
    this.remove.emit();
  }
}
