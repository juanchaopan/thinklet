import { Directive, computed, input } from '@angular/core';

/**
 * A white card with 20 px corners on the page background.
 *
 *   <section appCard>…</section>
 */
@Directive({
  selector: '[appCard]',
  host: { class: 'block rounded-card border border-line bg-surface p-5 shadow-card sm:p-6' },
})
export class Card {}

export type ChipTone = 'mint' | 'sun' | 'rose' | 'gray' | 'violet';

const CHIP_TONES: Record<ChipTone, string> = {
  mint: 'bg-mint text-mint-ink',
  sun: 'bg-sun text-sun-ink',
  rose: 'bg-rose text-rose-ink',
  gray: 'bg-canvas text-ink-soft',
  violet: 'bg-violet/10 text-violet',
};

/**
 * A small rounded label: the admin tag, a request's state, the age range.
 *
 *   <span appChip="sun">管理员</span>
 */
@Directive({
  selector: '[appChip]',
  host: { '[class]': 'classes()' },
})
export class Chip {
  readonly appChip = input.required<ChipTone>();

  protected readonly classes = computed(
    () =>
      `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${CHIP_TONES[this.appChip()]}`,
  );
}

/** The red badge with the number of requests waiting, next to a menu entry. */
@Directive({
  selector: '[appBadge]',
  host: {
    class:
      'inline-flex min-w-5 items-center justify-center rounded-full bg-badge px-1.5 text-xs leading-5 font-bold text-white',
  },
})
export class Badge {}

/**
 * The red dot for news without a number, such as request results not yet
 * seen. It is only a mark; the entry it sits on says the same in words for
 * screen readers.
 *
 *   <span appDot></span>
 */
@Directive({
  selector: '[appDot]',
  host: { 'aria-hidden': 'true', class: 'block size-2.5 shrink-0 rounded-full bg-badge' },
})
export class Dot {}
