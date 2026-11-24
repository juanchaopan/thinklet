import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ChildBooksResponse } from '@thinklet/contracts';
import { countText } from '../../core/layout/waiting-count';
import { Art } from '../../shared/ui/art';
import { BookGrid, BookTile } from '../../shared/ui/book-tile';
import { Badge, Card } from '../../shared/ui/card';

/**
 * 我的书 on the child's home page (rules.md, 孩子首页): the books assigned to
 * the child, latest assignment first and all at once, as cards like the
 * library's without the footer. A book the child has not opened yet carries
 * 新 over its cover, and the red count beside the heading says how many
 * such books there are; an inactive book carries 已下架.
 *
 * Books cannot be opened yet, so the cards lead nowhere: they are neither
 * links nor buttons, take no focus and do not lift under the mouse. The
 * count is only a mark; screen readers hear it as part of the heading,
 * "我的书，2 本新书". Without books it says 还没有书 with the seedling.
 */
@Component({
  selector: 'app-my-books',
  imports: [Art, Badge, BookGrid, BookTile, Card],
  host: { class: 'block' },
  template: `
    @if (shelf().books.length > 0) {
      <section class="flex flex-col gap-4">
        <h2 class="flex items-center gap-2 text-2xl font-black">
          我的书
          @if (newCount(); as count) {
            <span appBadge aria-hidden="true">{{ count }}</span>
            <span class="sr-only">，{{ count }} 本新书</span>
          }
        </h2>
        <app-book-grid>
          @for (book of shelf().books; track book.id) {
            <app-book-tile [book]="book" [isNew]="book.isNew" />
          }
        </app-book-grid>
      </section>
    } @else {
      <section appCard>
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          <img alt="" appArt="seedling" class="size-20" />
          <h2 class="text-2xl font-black">还没有书</h2>
          <p class="text-lg text-ink-soft">家长给你分派书以后，会出现在这里。</p>
        </div>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyBooks {
  readonly shelf = input.required<ChildBooksResponse>();

  /** The count of new books as its badge writes it; empty without new books. */
  protected readonly newCount = computed(() => {
    const count = this.shelf().newCount;
    return count > 0 ? countText(count) : '';
  });
}
