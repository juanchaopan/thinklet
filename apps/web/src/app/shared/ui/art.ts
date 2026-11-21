import { ChangeDetectionStrategy, Component, Directive, computed, input } from '@angular/core';

/** The project's illustrated icons, `public/art/icon-<name>.webp`. */
export type IconArt =
  | 'home'
  | 'settings'
  | 'letter'
  | 'family'
  | 'key'
  | 'globe'
  | 'seedling'
  | 'hourglass'
  | 'crown'
  | 'door'
  | 'search'
  | 'wrench'
  | 'party';

/** The rabbit teacher: full body pointing right, or half body waving. */
export type RabbitArt = 'rabbit' | 'rabbit-wave';

export type ArtName = IconArt | RabbitArt;

function artFile(name: ArtName): string {
  return name === 'rabbit' || name === 'rabbit-wave'
    ? `/art/${name}.webp`
    : `/art/icon-${name}.webp`;
}

/**
 * Shows one of the project's pictures. They decorate text that says the same
 * thing, so the image carries an empty `alt`. The size comes from the
 * element's classes.
 *
 *   <img alt="" appArt="wrench" class="size-11" />
 */
@Directive({
  selector: 'img[appArt]',
  host: {
    '[src]': 'src()',
    draggable: 'false',
    class: 'block shrink-0 object-contain select-none',
  },
})
export class Art {
  readonly appArt = input.required<ArtName>();

  protected readonly src = computed(() => artFile(this.appArt()));
}

/**
 * The logo, read out as the product name. The full logo carries the name
 * along the orbit and is only shown large; the mark is the planet alone, for
 * the navigation. When a page opens it turns and grows into place.
 */
@Component({
  selector: 'app-logo',
  host: { class: 'flex shrink-0' },
  template: `<img
    [src]="mark() ? '/art/logo-mark.webp' : '/art/logo.webp'"
    alt="好奇星球"
    draggable="false"
    [style.height.px]="height()"
    class="w-auto animate-planet select-none"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  /** The height in CSS pixels. */
  readonly height = input.required<number>();
  readonly mark = input(false);
}
