import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { meResponseSchema, parentNameSchema } from '@thinklet/contracts';
import { Api } from '../../core/api';
import { isSignedOut, showSomethingWentWrong } from '../../core/failures';
import { FieldEditing } from '../../core/field-editing';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { Button } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EditableField } from '../../shared/ui/editable-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';
import { LineIcon } from '../../shared/ui/line-icon';
import { Toaster } from '../../shared/ui/toast';
import { DeleteAccount } from './delete-account';

/**
 * The hints for a name that cannot be saved (rules.md, 个人设置). A name is
 * any text, so only an empty or a long one is rejected; a name is too short
 * only when it is empty.
 */
const NAME_HINTS: FieldHints = {
  required: '请填名字',
  too_short: '请填名字',
  too_long: '名字最多 20 个字',
  invalid: '请填名字',
};

/** The hint for a name that fails the shared name rule, or null when it may be saved. */
export function nameHint(value: string): string | null {
  return fieldHint(parentNameSchema, NAME_HINTS, value);
}

/**
 * The parent's own settings at `/profile`: the name, changed with the pencil
 * (in place with a mouse, in a sheet on a touch screen) and saved with the
 * 已保存 toast, the email as the identity provider reports it (— when there
 * is none), signing out and, under a thin line at the foot, deleting the
 * account. A parent without a family reaches it from the start page, in the
 * frame without menus, and goes back there with 返回.
 */
@Component({
  selector: 'app-profile',
  imports: [Art, Button, Card, DeleteAccount, EditableField, LineIcon, RouterLink],
  template: `
    @if (session.me(); as me) {
      <div class="mx-auto flex w-full max-w-3xl stagger flex-col gap-5">
        @if (me.families.length === 0) {
          <div>
            <a appButton="text" routerLink="/start" class="-ml-3 pl-2">
              <app-line-icon name="back" />返回
            </a>
          </div>
        }
        <header class="flex flex-col gap-1">
          <h1 class="text-3xl font-black">个人设置</h1>
        </header>
        <section appCard>
          <dl class="divide-y divide-line">
            <div class="py-5 first:pt-0 last:pb-0">
              <dt class="text-sm font-bold text-ink-muted">名字</dt>
              <dd class="mt-1">
                <app-editable-field
                  [value]="me.name"
                  label="名字"
                  action="改名字"
                  [validate]="nameHint"
                  [editing]="name.editing()"
                  [saving]="name.saving()"
                  [error]="name.serverError()"
                  (started)="name.start()"
                  (cancelled)="name.stop()"
                  (save)="save($event)"
                />
              </dd>
            </div>
            <div class="py-5 first:pt-0 last:pb-0">
              <dt class="text-sm font-bold text-ink-muted">邮箱</dt>
              <dd class="mt-1">
                <p class="flex min-h-11 items-center text-base font-bold">{{ me.email ?? '—' }}</p>
              </dd>
            </div>
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
        <app-delete-account />
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);

  protected readonly nameHint = nameHint;
  protected readonly name = new FieldEditing('name', NAME_HINTS);
  protected readonly signingOut = signal(false);

  protected save(name: string): Promise<void> {
    return this.name.save(
      () => this.api.send('PATCH', '/api/me', { name: name.trim() }, meResponseSchema),
      (me) => {
        this.session.replace(me);
      },
    );
  }

  /** Signs out here and at the identity provider; a failure other than a 401 says 出了点问题. */
  protected async logout(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.session.logout();
    } catch (error) {
      if (!isSignedOut(error)) {
        showSomethingWentWrong(this.toaster);
      }
      this.signingOut.set(false);
    }
  }
}
