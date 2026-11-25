import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { Avatar } from '../../shared/ui/avatar';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { Checkbox } from '../../shared/ui/checkbox';
import { LineIcon } from '../../shared/ui/line-icon';

/**
 * The card that greets one child before the child signs in: the big avatar,
 * 你好，<nickname>！ and a line saying what to do, then the form: the
 * password fields given as content, 在这台设备上记住我, why the api turned
 * the last try down (`refusal`), when it did, and the button that signs in,
 * named `action`, and `pendingAction` while `sending`. Submitting the form
 * emits `send`. With `canGoBack`, 返回 at the top left emits `back`.
 */
@Component({
  selector: 'app-greeting-card',
  imports: [Avatar, Button, Card, Checkbox, LineIcon],
  host: { class: 'block w-full' },
  template: `
    <section appCard class="relative w-full animate-rise [animation-delay:150ms]">
      @if (canGoBack()) {
        <span class="absolute top-3 left-3">
          <button type="button" appButton="text" class="pl-2! text-base!" (click)="back.emit()">
            <app-line-icon name="back" />返回
          </button>
        </span>
      }
      <div class="flex flex-col items-center text-center">
        <app-avatar [name]="nickname()" [personId]="childId()" size="greeting" />
        <h1 class="mt-4 text-2xl font-black">你好，{{ nickname() }}！</h1>
        <p class="mt-1 text-lg text-ink-soft">{{ line() }}</p>
      </div>
      <form novalidate (submit)="send.emit($event)">
        <ng-content />
        <app-checkbox class="mt-3" [large]="true" [(checked)]="remember"
          >在这台设备上记住我</app-checkbox
        >
        @if (refusal(); as message) {
          <p role="alert" class="mt-2 animate-fade text-base font-bold text-rose-ink">
            {{ message }}
          </p>
        }
        <button
          type="submit"
          appButton
          class="mt-5 min-h-14! w-full text-lg!"
          [disabled]="sending()"
        >
          {{ sending() ? pendingAction() : action() }}
        </button>
      </form>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GreetingCard {
  readonly childId = input.required<string>();
  readonly nickname = input.required<string>();
  readonly line = input.required<string>();
  readonly action = input.required<string>();
  readonly pendingAction = input.required<string>();
  readonly sending = input(false);
  readonly canGoBack = input(false);
  /** Why the api turned the last try down, said above the button; null while it has not. */
  readonly refusal = input<string | null>(null);
  readonly remember = model(true);

  readonly send = output<Event>();
  readonly back = output();
}
