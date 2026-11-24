import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { truncateCharacters } from '@thinklet/contracts';

/** The avatar colours of look.md. */
const COLORS = ['bg-violet', 'bg-sky', 'bg-mint-ink', 'bg-fuchsia', 'bg-sun-ink'] as const;

/**
 * The colour of a person's avatar, worked out from the id of the parent or
 * the child with the 32-bit FNV-1a hash, so the same person has the same
 * colour on every page and in every family.
 */
export function avatarColor(personId: string): (typeof COLORS)[number] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < personId.length; index++) {
    hash ^= personId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COLORS[hash % COLORS.length] ?? COLORS[0];
}

/** The big avatars of the child's pages stand out from their card with a white ring and a shadow. */
const RAISED = 'shadow-card ring-4 ring-surface';

/**
 * The avatars that overlap in a row, each ringed in the card's white so the
 * one in front stays apart from the one behind. They are a size smaller on
 * phones, where book cards are narrowest.
 */
export const STACKED = 'size-6 text-xs ring-2 ring-surface sm:size-7';

/** The overlapping avatars of a book page's 谁能读 button, 32 px at every size. */
export const STACKED_LARGE = 'size-8 text-xs ring-2 ring-surface';

const SIZES = {
  tiny: 'size-6 text-xs',
  stack: STACKED,
  stackLarge: STACKED_LARGE,
  mark: 'size-7 text-xs',
  small: 'size-8 text-sm',
  regular: 'size-9 text-sm',
  large: 'size-10 text-base',
  list: 'size-11 text-base',
  bar: 'size-11 text-lg',
  greeting: `size-24 text-4xl ${RAISED}`,
  pick: `size-24 text-4xl sm:size-28 sm:text-5xl ${RAISED}`,
} as const;

/**
 * The avatar of a parent or a child (look.md, 颜色): the first character of
 * the name (a child's nickname) on a round patch in the person's own colour.
 * It sits next to the name, so screen readers skip it.
 */
@Component({
  selector: 'app-avatar',
  host: {
    'aria-hidden': 'true',
    '[class]': 'classes()',
  },
  template: '{{ initial() }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Avatar {
  readonly name = input.required<string>();
  /** What the colour is worked out from: the id of the parent or the child. */
  readonly personId = input.required<string>();
  /**
   * `tiny` goes inside a line of small text, such as the admin of a family
   * found by its code; `stack` is one of the overlapping readers of a book
   * card, and `stackLarge` one of those of the 谁能读 button on a book page;
   * `mark` leads a child's entry in a short menu, such as the scope of the
   * library; `small` heads the parent's group in the sidebar; `large` heads
   * the parent's menu and the actions of a member or a child, marks the
   * child a notice is about and leads a child's row of who reads a book;
   * `list` leads a row of a list of people, such as the family's members or
   * its children; `bar` is the signed-in child in the top bar of the child's
   * home page; `greeting` greets the child on the QR login page; `pick` is a
   * child to tap on the child login of a device that remembers children.
   */
  readonly size = input<keyof typeof SIZES>('regular');

  protected readonly initial = computed(() => truncateCharacters(this.name(), 1));

  protected readonly classes = computed(
    () =>
      `${SIZES[this.size()]} ${avatarColor(this.personId())} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`,
  );
}
