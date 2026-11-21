import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { truncateCharacters } from '@thinklet/contracts';

/** The avatar colours, taken in turn by the parents of a family. */
const COLORS = ['bg-violet', 'bg-sky', 'bg-mint-ink', 'bg-fuchsia', 'bg-sun-ink'];

/**
 * A parent's avatar: the first character of the name on a round coloured
 * patch. It sits next to the name, so screen readers skip it. `colorIndex` is
 * the parent's place in the family; the colours repeat after five parents.
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
  readonly colorIndex = input(0);
  /** `large` is the size shown at the top of a member's actions. */
  readonly size = input<'regular' | 'large'>('regular');

  protected readonly initial = computed(() => truncateCharacters(this.name(), 1));

  protected readonly classes = computed(() => {
    const color = COLORS[((this.colorIndex() % COLORS.length) + COLORS.length) % COLORS.length];
    const size = this.size() === 'large' ? 'size-10 text-base' : 'size-9 text-sm';
    return `${size} ${color} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`;
  });
}
