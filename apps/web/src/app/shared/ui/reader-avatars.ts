import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { BookReader } from '@thinklet/contracts';
import { Avatar, STACKED, STACKED_LARGE } from './avatar';
import { LineIcon } from './line-icon';

/** A child who reads a book, as the avatars show them. */
export type Reader = BookReader;

/** How many readers show as avatars before the rest are counted. */
const SHOWN = 3;

/**
 * Who reads a book, in words: the nicknames joined by 、 and then 可以读,
 * as in “小米、豆豆可以读”; `whenNone` while nobody reads it.
 */
export function readersInWords(readers: readonly Reader[], whenNone: string): string {
  return readers.length > 0
    ? `${readers.map(({ nickname }) => nickname).join('、')}可以读`
    : whenNone;
}

/**
 * The children who read a book (look.md, 书的卡片): their avatars, slightly
 * overlapping, at most three and then “+2” for the rest; while nobody reads
 * it, a 32 px dashed circle with a plus. On a card the avatars are 24 px
 * (28 px from 640 px); on a book page's 谁能读 button (`large`) they are
 * 32 px and overlap a little more. Only a mark: the button around it
 * carries the name for screen readers.
 */
@Component({
  selector: 'app-reader-avatars',
  imports: [Avatar, LineIcon],
  host: { 'aria-hidden': 'true', class: 'inline-flex' },
  template: `
    @if (readers().length > 0) {
      <span class="flex" [class]="large() ? '-space-x-2' : '-space-x-2 sm:-space-x-1.5'">
        @for (reader of shown(); track reader.childId) {
          <app-avatar
            [name]="reader.nickname"
            [personId]="reader.childId"
            [size]="large() ? 'stackLarge' : 'stack'"
          />
        }
        @if (more() > 0) {
          <span
            class="inline-flex shrink-0 items-center justify-center rounded-full bg-canvas font-bold text-ink-soft {{
              countSize()
            }}"
            >+{{ more() }}</span
          >
        }
      </span>
    } @else {
      <span
        class="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-ink-muted"
      >
        <app-line-icon name="plus" />
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReaderAvatars {
  readonly readers = input.required<readonly Reader[]>();
  /** Whether the avatars are those of a book page's 谁能读 button. */
  readonly large = input(false);

  protected readonly shown = computed(() => this.readers().slice(0, SHOWN));
  protected readonly more = computed(() => Math.max(0, this.readers().length - SHOWN));
  protected readonly countSize = computed(() => (this.large() ? STACKED_LARGE : STACKED));
}
