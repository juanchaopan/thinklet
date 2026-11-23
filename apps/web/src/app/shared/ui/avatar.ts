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

const SIZES = {
  tiny: 'size-6 text-xs',
  small: 'size-8 text-sm',
  regular: 'size-9 text-sm',
  large: 'size-10 text-base',
  list: 'size-11 text-base',
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
   * found by its code; `small` heads the parent's group in the sidebar;
   * `large` heads the parent's menu and the actions of a member or a child;
   * `list` leads a row of a list of people, such as the family's members or
   * its children.
   */
  readonly size = input<keyof typeof SIZES>('regular');

  protected readonly initial = computed(() => truncateCharacters(this.name(), 1));

  protected readonly classes = computed(
    () =>
      `${SIZES[this.size()]} ${avatarColor(this.personId())} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`,
  );
}
