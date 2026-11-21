import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The start page at `/start` for a signed-in parent who has no family yet. */
@Component({
  selector: 'app-start',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Start {}
