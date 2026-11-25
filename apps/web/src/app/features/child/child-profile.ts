import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  childMeResponseSchema,
  childNicknameSchema,
  type ChildMeResponse,
} from '@thinklet/contracts';
import { Api, type ApiError } from '../../core/api';
import { CHILD_HOME_PATH, ChildSession } from '../../core/child-session';
import { whenBackInFront } from '../../core/connectivity';
import { asApiError, isSignedOut, showSomethingWentWrong } from '../../core/failures';
import { FieldEditing } from '../../core/field-editing';
import { PublicLayout } from '../../core/layout/public-layout';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EditableField } from '../../shared/ui/editable-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';
import { LineIcon } from '../../shared/ui/line-icon';
import { PageProblem } from '../../shared/ui/page-problem';
import { Toaster } from '../../shared/ui/toast';
import { ChildTopBar } from './child-top-bar';

/**
 * The hints for a nickname that cannot be saved, the same as when a parent
 * adds the child (rules.md, 孩子). A nickname is too short only when it is
 * empty, so both say to fill it in.
 */
const NICKNAME_HINTS: FieldHints = {
  required: '请填昵称',
  too_short: '请填昵称',
  too_long: '昵称最多 10 个字',
  invalid: '请填昵称',
};

/** The hint for a nickname that fails the parents' nickname rule, or null when it may be saved. */
export function nicknameHint(value: string): string | null {
  return fieldHint(childNicknameSchema, NICKNAME_HINTS, value);
}

/**
 * The child's own settings at `/child/profile` (rules.md, 孩子的个人设置),
 * under the child's top bar, where the avatar shows this page as current.
 * 返回 goes back to the child's home page. One card holds the nickname,
 * changed with the pencil (in place with a mouse, in the 改昵称 sheet on a
 * touch screen) by the parents' rule and saved with the 已保存 toast, the
 * account and the family's name, which the child cannot change. Under it
 * 退出登录 signs the child out, leaving the children this browser
 * remembers, and opens the child login.
 *
 * The account and the family's name are read when the page opens. When
 * they cannot be, the content under the top bar says the page did not
 * open, with a retry. The child is asked about again whenever the window
 * comes back to the front, so a child deleted or whose password was reset
 * meanwhile goes to the child login.
 */
@Component({
  selector: 'app-child-profile',
  imports: [
    Art,
    Button,
    Card,
    ChildTopBar,
    EditableField,
    LineIcon,
    PageProblem,
    PublicLayout,
    RouterLink,
  ],
  template: `
    @if (child(); as child) {
      <div class="flex min-h-screen flex-col">
        <app-child-top-bar [child]="child" [current]="true" />
        <main class="flex-1 px-4 py-6 sm:px-8 sm:py-10">
          @if (failure(); as failure) {
            <app-page-problem kind="server" [requestId]="failure.requestId" (action)="load()" />
          } @else if (profile(); as profile) {
            <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
              <div>
                <a appButton="text" [routerLink]="homePath" class="-ml-3 pl-2">
                  <app-line-icon name="back" />返回
                </a>
              </div>
              <h1 class="text-3xl font-black">个人设置</h1>
              <section appCard>
                <dl class="divide-y divide-line">
                  <div class="py-5 first:pt-0 last:pb-0">
                    <dt class="text-sm font-bold text-ink-muted">昵称</dt>
                    <dd class="mt-1">
                      <app-editable-field
                        [value]="profile.nickname"
                        label="昵称"
                        action="改昵称"
                        [validate]="nicknameHint"
                        [editing]="nickname.editing()"
                        [saving]="nickname.saving()"
                        [error]="nickname.serverError()"
                        (started)="nickname.start()"
                        (cancelled)="nickname.stop()"
                        (save)="save($event)"
                      />
                    </dd>
                  </div>
                  @for (fact of facts(); track fact.label) {
                    <div class="py-5 first:pt-0 last:pb-0">
                      <dt class="text-sm font-bold text-ink-muted">{{ fact.label }}</dt>
                      <dd class="mt-1">
                        <p class="flex min-h-11 items-center text-base font-bold">
                          {{ fact.value }}
                        </p>
                      </dd>
                    </div>
                  }
                </dl>
              </section>
              <div class="flex justify-end">
                <button
                  type="button"
                  appButton="secondary"
                  class="w-full sm:w-auto"
                  [disabled]="signingOut()"
                  (click)="logout()"
                >
                  <img alt="" appArt="door" class="size-6" />退出登录
                </button>
              </div>
            </div>
          }
        </main>
      </div>
    } @else if (childSession.status() === 'failed') {
      <app-public-layout>
        <div class="px-5 sm:px-8">
          <app-page-problem
            kind="server"
            [requestId]="childSession.failure()?.requestId"
            (action)="retry()"
          />
        </div>
      </app-public-layout>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildProfile {
  protected readonly childSession = inject(ChildSession);
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);

  protected readonly homePath = CHILD_HOME_PATH;
  protected readonly nicknameHint = nicknameHint;
  protected readonly child = this.childSession.child;
  /** The child as `/api/child/me` answered, once it has. */
  protected readonly profile = signal<ChildMeResponse | null>(null);
  /** Why the child's settings could not be read. */
  protected readonly failure = signal<ApiError | null>(null);
  protected readonly nickname = new FieldEditing('nickname', NICKNAME_HINTS);
  protected readonly signingOut = signal(false);

  /** What the child sees and cannot change: the account and the family's name. */
  protected readonly facts = computed(() => {
    const profile = this.profile();
    return profile === null
      ? []
      : [
          { label: '账号', value: profile.account },
          { label: '家庭', value: profile.familyName },
        ];
  });

  constructor() {
    if (this.childSession.status() === 'signed-in') {
      void this.load();
    }
    whenBackInFront(() => {
      void this.childSession.refresh();
    });
  }

  /** Reads the child's settings; a failure other than a 401 says the page did not open. */
  protected async load(): Promise<void> {
    this.failure.set(null);
    try {
      this.profile.set(await this.api.get('/api/child/me', childMeResponseSchema));
    } catch (error) {
      if (!isSignedOut(error)) {
        this.failure.set(asApiError(error));
      }
    }
  }

  /** Saves the nickname, which the top bar and the greeting show from then on. */
  protected save(nickname: string): Promise<void> {
    return this.nickname.save(
      () =>
        this.api.send(
          'PATCH',
          '/api/child/me',
          { nickname: nickname.trim() },
          childMeResponseSchema,
        ),
      (child) => {
        this.profile.set(child);
        this.childSession.replace(child);
      },
    );
  }

  /** Signs the child out; a failure other than a 401 says 出了点问题 and the child stays. */
  protected async logout(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.childSession.logout();
    } catch (error) {
      if (!isSignedOut(error)) {
        showSomethingWentWrong(this.toaster);
      }
      this.signingOut.set(false);
    }
  }

  /** Asks for the child again; once the child is there, its settings follow. */
  protected async retry(): Promise<void> {
    if (await this.childSession.retry()) {
      await this.load();
    }
  }
}
