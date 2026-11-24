import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Avatar, STACKED } from './avatar';
import { LineIcon } from './line-icon';

/** A child who reads a book, as the avatars show them. */
export interface Reader {
  readonly childId: string;
  readonly nickname: string;
}

/** How many readers show as avatars before the rest are counted. */
const SHOWN = 3;

/**
 * The children who read a book (look.md, 书的卡片): their avatars, slightly
 * overlapping, at most three and then “+2” for the rest; while nobody reads
 * it, a 32 px dashed circle with a plus. Only a mark: the button around it
 * carries the name for screen readers.
 */
@Component({
  selector: 'app-reader-avatars',
  imports: [Avatar, LineIcon],
  host: { 'aria-hidden': 'true', class: 'inline-flex' },
  template: `
    @if (readers().length > 0) {
      <span class="flex -space-x-2 sm:-space-x-1.5">
        @for (reader of shown(); track reader.childId) {
          <app-avatar [name]="reader.nickname" [personId]="reader.childId" size="stack" />
        }
        @if (more() > 0) {
          <span
            class="inline-flex shrink-0 items-center justify-center rounded-full bg-canvas font-bold text-ink-soft {{
              stacked
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

  protected readonly stacked = STACKED;
  protected readonly shown = computed(() => this.readers().slice(0, SHOWN));
  protected readonly more = computed(() => Math.max(0, this.readers().length - SHOWN));
}
