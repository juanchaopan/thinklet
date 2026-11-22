import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Art, type IconArt } from './art';
import { Button } from './button';
import { Card } from './card';

export type PageProblemKind = 'not-found' | 'server';

interface ProblemText {
  readonly icon: IconArt;
  readonly title: string;
  readonly text: string;
  readonly action: string;
}

const PROBLEMS: Record<PageProblemKind, ProblemText> = {
  'not-found': {
    icon: 'search',
    title: '找不到这个家庭',
    text: '它不存在，或者你已经不是成员。',
    action: '回到我的家庭',
  },
  server: {
    icon: 'wrench',
    title: '页面没能打开',
    text: '出了点问题，请稍后再试。',
    action: '重试',
  },
};

/**
 * The error number shown for a request: the first 8 characters of its id,
 * written in two groups of four ("a1f3-92c0"). The logs find the request by
 * the same 8 characters.
 */
export function errorNumber(requestId: string): string {
  const leading = requestId.replaceAll('-', '').slice(0, 8);
  return leading.length > 4 ? `${leading.slice(0, 4)}-${leading.slice(4)}` : leading;
}

/**
 * A page whose content could not be shown, in place of that content: the
 * family is not there (or the parent is no longer a member), or the server
 * failed while the page was opening. The server problem shows the error
 * number of the request; without an answer from the server there is no
 * request id and no error number. The button emits `action`: back to the
 * parent's own family, or try again.
 */
@Component({
  selector: 'app-page-problem',
  imports: [Art, Button, Card],
  host: { class: 'mx-auto block w-full max-w-md animate-rise py-10' },
  template: `
    <section appCard>
      <div class="flex flex-col items-center text-center">
        <img alt="" [appArt]="problem().icon" class="size-16" />
        <h1 class="mt-4 text-2xl font-black">{{ problem().title }}</h1>
        <p class="mt-2 text-base text-ink-soft">{{ problem().text }}</p>
        @if (kind() === 'server' && number()) {
          <p class="mt-3 font-mono text-sm text-ink-muted">错误编号 {{ number() }}</p>
        }
        <div class="mt-6 w-full">
          <button type="button" appButton class="w-full" (click)="action.emit()">
            {{ problem().action }}
          </button>
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageProblem {
  readonly kind = input.required<PageProblemKind>();
  /** The id of the request that failed, as the error response gave it. */
  readonly requestId = input<string>();

  readonly action = output();

  protected readonly problem = computed(() => PROBLEMS[this.kind()]);
  protected readonly number = computed(() => {
    const requestId = this.requestId();
    return requestId ? errorNumber(requestId) : '';
  });
}
