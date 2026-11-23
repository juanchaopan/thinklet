import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PublicLayout } from '../../core/layout/public-layout';
import { Art } from '../../shared/ui/art';

/**
 * The frame of the child's login pages: only the full logo at the top, and a
 * column in the middle of the screen holding the card and what goes under
 * it. With `rabbit` the rabbit teacher waves over the card (the child login
 * and the page of an invalid QR code); as on the product home it rises into
 * place, then bobs gently.
 */
@Component({
  selector: 'app-child-column',
  imports: [Art, PublicLayout],
  template: `
    <app-public-layout>
      <div
        class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 px-5 py-8"
      >
        @if (rabbit()) {
          <div aria-hidden="true" class="w-36 animate-rabbit sm:w-44">
            <div class="animate-bob motion-reduce:animate-none">
              <img alt="" appArt="rabbit-wave" class="w-full" />
            </div>
          </div>
        }
        <ng-content />
      </div>
    </app-public-layout>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildColumn {
  readonly rabbit = input(false);
}
