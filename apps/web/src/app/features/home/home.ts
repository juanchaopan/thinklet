import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The home page at `/`. By design it shows nothing. */
@Component({
  selector: 'app-home',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {}
