import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BookStatus } from '@thinklet/contracts';
import { LineIcon } from './line-icon';

/** What a book card shows of a book, the same for the parents' library and a child's books. */
export interface ShownBook {
  readonly title: string;
  readonly intro: string;
  readonly grade: { readonly name: string };
  readonly subject: { readonly name: string };
  readonly status: BookStatus;
  readonly coverUrl: string | null;
}

/** A label on a cover: a small pill in a top corner. */
const COVER_TAG = 'absolute top-2 rounded-full px-2.5 py-1 text-xs font-bold shadow-card';

/**
 * A book's cover at 3:4 (look.md, 书). A book without its own cover yet, or
 * whose cover cannot be read, shows the default one: the tint colour with a
 * line book a third as wide as the cover in the middle. An inactive book
 * (`retired`) carries 已下架 at the top left; a book the child has not opened
 * yet (`isNew`) carries 新 at the top right. It is as wide as its box unless
 * the owner sizes it, and the owner rounds its corners.
 */
@Component({
  selector: 'app-book-cover',
  imports: [LineIcon],
  host: { class: 'relative block aspect-3/4 overflow-hidden' },
  template: `
    @if (coverUrl() && !broken()) {
      <img
        alt=""
        draggable="false"
        class="block size-full object-cover select-none"
        [src]="coverUrl()"
        (error)="broken.set(true)"
      />
    } @else {
      <div class="flex size-full items-center justify-center bg-tint text-primary">
        <app-line-icon name="book" class="aspect-square w-1/3" />
      </div>
    }
    @if (retired()) {
      <span class="left-2 bg-surface text-ink-soft {{ tag }}">已下架</span>
    }
    @if (isNew()) {
      <span class="right-2 bg-badge text-white {{ tag }}">新</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookCover {
  /** The cover's address, which changes with the cover; null without a cover. */
  readonly coverUrl = input.required<string | null>();
  readonly retired = input(false);
  readonly isNew = input(false);

  protected readonly tag = COVER_TAG;

  /** Whether the cover failed to load; a new address is tried afresh. */
  protected readonly broken = linkedSignal({ source: this.coverUrl, computation: () => false });
}

/**
 * A book in a grid (rules.md, 书的卡片): a white card with the cover on top,
 * then the title in at most two lines, “一年级 · 数学” and the introduction
 * in at most two lines. With a `link` the whole card leads there, through
 * the title's link stretched over the card, and with a mouse it lifts a
 * little while hovered. The card's footer is its content, the children
 * marked `appBookTileCorner` sit over the cover's top right; both stay above
 * the stretched link, so pressing them does not follow it. The card does not
 * clip what it holds; the cover rounds its own top corners.
 *
 *   <app-book-tile [book]="book" link="/books/…">…footer…</app-book-tile>
 */
@Component({
  selector: 'app-book-tile',
  imports: [BookCover, RouterLink],
  host: { class: 'block' },
  template: `
    <article
      class="relative flex h-full flex-col rounded-card border border-line bg-surface shadow-card"
      [class]="
        link() ? 'transition duration-150 mouse:hover:-translate-y-0.5 mouse:hover:shadow-pop' : ''
      "
    >
      <app-book-cover
        class="rounded-t-[calc(var(--radius-card)-1px)]"
        [coverUrl]="book().coverUrl"
        [retired]="book().status === 'inactive'"
        [isNew]="isNew()"
      />
      <div class="absolute top-2 right-2 z-1 empty:hidden">
        <ng-content select="[appBookTileCorner]" />
      </div>
      <div class="flex flex-1 flex-col p-3 sm:p-4">
        <h3 class="line-clamp-2 text-base leading-snug font-black">
          @if (link(); as link) {
            <a
              class="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-violet/40"
              [routerLink]="link"
              >{{ book().title }}</a
            >
          } @else {
            {{ book().title }}
          }
        </h3>
        <p class="mt-1 text-xs font-bold text-ink-muted">
          {{ book().grade.name }} · {{ book().subject.name }}
        </p>
        <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">{{ book().intro }}</p>
        <div class="mt-auto flex min-h-11 items-center gap-1 pt-3 empty:hidden sm:gap-2">
          <ng-content />
        </div>
      </div>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookTile {
  readonly book = input.required<ShownBook>();
  /** Where the card leads; null for a card that leads nowhere. */
  readonly link = input<string | null>(null);
  /** Whether the cover carries 新, for a book the child has not opened yet. */
  readonly isNew = input(false);
}

/**
 * Book cards two to a row where the content is narrowest (phones), three
 * from 576 px of content (tablets) and four from 896 px (the desktop), by
 * the width of the grid's own box.
 */
@Component({
  selector: 'app-book-grid',
  host: { class: '@container block' },
  template: `
    <div class="grid grid-cols-2 gap-3 @xl:grid-cols-3 @xl:gap-4 @4xl:grid-cols-4">
      <ng-content />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookGrid {}
