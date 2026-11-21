import { Directive, computed, input } from '@angular/core';

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'text';

/** Darkens on hover (mouse only) and shrinks slightly while pressed, both in 100 ms. */
export const PRESS =
  'transition duration-100 ease-move active:scale-[0.97] disabled:cursor-default disabled:opacity-60 disabled:active:scale-100';

const KINDS: Record<ButtonKind, string> = {
  primary: 'min-h-12 px-6 text-base bg-primary text-white hover:bg-primary-hover',
  secondary:
    'min-h-12 px-6 text-base border border-line-strong bg-surface text-ink hover:bg-canvas',
  danger: 'min-h-12 px-6 text-base bg-rose-ink text-white',
  text: 'min-h-11 px-4 text-sm text-ink-soft hover:bg-canvas',
};

/** The primary button next to a text box when editing in place: full height, small text. */
const COMPACT_PRIMARY = 'min-h-12 px-6 text-sm bg-primary text-white hover:bg-primary-hover';

/**
 * A pill-shaped button or link, at least 44 px high. `compact` gives a
 * primary button the small text it has next to a text box when editing in
 * place.
 *
 *   <button type="button" appButton="secondary">取消</button>
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: { '[class]': 'classes()' },
})
export class Button {
  readonly appButton = input<ButtonKind | ''>('primary');
  readonly compact = input(false);

  protected readonly classes = computed(() => {
    const kind = this.appButton() || 'primary';
    const look = kind === 'primary' && this.compact() ? COMPACT_PRIMARY : KINDS[kind];
    return `inline-flex items-center justify-center gap-2 rounded-full font-bold ${look} ${PRESS}`;
  });
}

/**
 * A 44×44 round button holding only a symbol. It must carry an `aria-label`,
 * the name screen readers announce.
 */
@Directive({
  selector: 'button[appIconButton]',
  host: {
    class: `inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-canvas ${PRESS}`,
  },
})
export class IconButton {}
