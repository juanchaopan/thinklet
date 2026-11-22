import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { truncateCharacters } from '@thinklet/contracts';

/** The avatar colours of look.md. */
const COLORS = ['bg-violet', 'bg-sky', 'bg-mint-ink', 'bg-fuchsia', 'bg-sun-ink'] as const;

/**
 * The colour of a parent's avatar, worked out from the parent's id with the
 * 32-bit FNV-1a hash, so the same parent has the same colour on every page
 * and in every family.
 */
export function avatarColor(parentId: string): (typeof COLORS)[number] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < parentId.length; index++) {
    hash ^= parentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COLORS[hash % COLORS.length] ?? COLORS[0];
}

const SIZES = {
  small: 'size-8 text-sm',
  regular: 'size-9 text-sm',
  large: 'size-10 text-base',
} as const;

/**
 * A parent's avatar: the first character of the name on a round patch in the
 * parent's own colour. It sits next to the name, so screen readers skip it.
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
  readonly parentId = input.required<string>();
  /**
   * `small` heads the parent's group in the sidebar; `large` heads the
   * parent's menu and a member's actions.
   */
  readonly size = input<keyof typeof SIZES>('regular');

  protected readonly initial = computed(() => truncateCharacters(this.name(), 1));

  protected readonly classes = computed(
    () =>
      `${SIZES[this.size()]} ${avatarColor(this.parentId())} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`,
  );
}
