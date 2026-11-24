import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { BookCover } from '../../shared/ui/book-tile';

/**
 * A book's cover drawn as a book (look.md, 书本页): the corners at the spine
 * smaller than those on the open side, a darker shade along the spine with
 * a thin crease beside it, and a deep soft shadow below. An inactive book
 * (`retired`) carries 已下架 like its card. The owner sets its width.
 */
@Component({
  selector: 'app-book-object',
  imports: [BookCover],
  host: { class: 'block' },
  template: `
    <div class="relative rounded-l-md rounded-r-2xl shadow-book">
      <app-book-cover
        class="rounded-l-md rounded-r-2xl"
        [coverUrl]="coverUrl()"
        [retired]="retired()"
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-0 w-5 rounded-l-md bg-linear-to-r from-ink/30 via-ink/10 to-transparent"
      ></span>
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-5 w-px bg-surface/40"
      ></span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookObject {
  /** The cover's address; null for a book without a cover yet. */
  readonly coverUrl = input.required<string | null>();
  readonly retired = input(false);
}

/**
 * The colour band behind the top of a book page (look.md, 书本页): the
 * book's own cover, blown up, blurred and faded, so the band takes only the
 * colours the cover has; a book without a cover, or whose cover cannot be
 * read, takes the tint colour. A mask thins the band out from 45% of its
 * height to nothing at its foot, so it melts into the page instead of
 * ending on a line. It fills its positioned owner and is only decoration.
 */
@Component({
  selector: 'app-cover-glow',
  host: {
    'aria-hidden': 'true',
    class:
      'absolute inset-0 overflow-hidden opacity-80 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]',
  },
  template: `
    @if (coverUrl() && !broken()) {
      <img
        alt=""
        class="size-full scale-150 object-cover opacity-70 blur-3xl"
        [src]="coverUrl()"
        (error)="broken.set(true)"
      />
    } @else {
      <div class="size-full bg-tint"></div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoverGlow {
  /** The cover's address; null for a book without a cover yet. */
  readonly coverUrl = input.required<string | null>();

  /** Whether the cover failed to load; a new address is tried afresh. */
  protected readonly broken = linkedSignal({ source: this.coverUrl, computation: () => false });
}
