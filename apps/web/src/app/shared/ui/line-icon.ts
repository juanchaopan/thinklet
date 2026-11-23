import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type LineIconName =
  | 'copy'
  | 'share'
  | 'qr'
  | 'device'
  | 'eye'
  | 'close'
  | 'pencil'
  | 'chevron'
  | 'check'
  | 'back'
  | 'forward'
  | 'search'
  | 'more';

/**
 * The project's line icons, drawn in the current text colour and hidden from
 * screen readers (the button around an icon carries the name). Copy, share,
 * QR, device and eye are 20 px with 1.75 px strokes, round caps and joins:
 * copy is two overlapping rounded squares, share an arrow rising out of an
 * open box, QR three finder corners and a few modules, device a tablet
 * standing upright with a short bar for its home button, for a remembered
 * device, and eye an almond outline around a round pupil, for the button
 * that shows a password. The chevron is 16 px and points down, for a button
 * that opens a menu or a list; back points left, for 返回; forward points
 * right, for a card that leads on; search is the magnifier of a search box;
 * more is three dots in a row, for the button that opens a row's actions.
 */
@Component({
  selector: 'app-line-icon',
  host: { class: 'inline-flex shrink-0', '[class.size-4]': "name() === 'chevron'" },
  template: `
    @switch (name()) {
      @case ('copy') {
        <svg
          class="size-5"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="7" y="7" width="10" height="10" rx="2.25" />
          <path
            d="M13 7V5.25A2.25 2.25 0 0 0 10.75 3h-5.5A2.25 2.25 0 0 0 3 5.25v5.5A2.25 2.25 0 0 0 5.25 13H7"
          />
        </svg>
      }
      @case ('share') {
        <svg
          class="size-5"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M7 8.5H6a2 2 0 0 0-2 2V15a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2h-1" />
          <path d="M10 12V2.75M6.75 6 10 2.75 13.25 6" />
        </svg>
      }
      @case ('qr') {
        <svg
          class="size-5"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="5.5" height="5.5" rx="1.25" />
          <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.25" />
          <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.25" />
          <g fill="currentColor" stroke="none">
            <rect x="11.5" y="11.5" width="2.25" height="2.25" rx=".5" />
            <rect x="14.75" y="11.5" width="2.25" height="2.25" rx=".5" />
            <rect x="14.75" y="14.75" width="2.25" height="2.25" rx=".5" />
          </g>
        </svg>
      }
      @case ('device') {
        <svg
          class="size-5"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="4.5" y="2.5" width="11" height="15" rx="2.25" />
          <path d="M8.5 14.5h3" />
        </svg>
      }
      @case ('eye') {
        <svg
          class="size-5"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
          <circle cx="10" cy="10" r="2.5" />
        </svg>
      }
      @case ('close') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="m5.5 5.5 9 9m0-9-9 9"
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      }
      @case ('pencil') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M12.8 4.2 15.8 7.2M4 16l.8-3.6L13.6 3.6a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2l-8.8 8.8L4 16Z"
            stroke="currentColor"
            stroke-width="1.6"
            fill="none"
            stroke-linejoin="round"
          />
        </svg>
      }
      @case ('chevron') {
        <svg class="size-4" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      }
      @case ('check') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="m5 10.5 3.2 3L15 7"
            stroke="currentColor"
            stroke-width="2.4"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      }
      @case ('back') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M12 4.5 6.5 10l5.5 5.5"
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      }
      @case ('forward') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="m8 5 5 5-5 5"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      }
      @case ('search') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.8" fill="none" />
          <path
            d="m13.2 13.2 3.3 3.3"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      }
      @case ('more') {
        <svg class="size-5" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
          <circle cx="4.5" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="15.5" cy="10" r="1.6" />
        </svg>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineIcon {
  readonly name = input.required<LineIconName>();
}
