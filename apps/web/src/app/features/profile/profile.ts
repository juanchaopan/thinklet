import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { meResponseSchema, parentNameSchema } from '@thinklet/contracts';
import { Api, ApiError } from '../../core/api';
import { Session } from '../../core/session';
import { Art } from '../../shared/ui/art';
import { Button, IconButton } from '../../shared/ui/button';
import { Card } from '../../shared/ui/card';
import { EditRow, EditSheet } from '../../shared/ui/edit-field';
import { fieldHint, type FieldHints } from '../../shared/ui/field-hint';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { Toaster } from '../../shared/ui/toast';

/**
 * The hints for a name that cannot be saved (rules.md, 个人设置). A name is
 * any text, so only an empty or a long one is rejected.
 */
const NAME_HINTS: FieldHints = {
  required: '请填名字',
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
 * is none), and signing out. A parent without a family reaches it from the
 * start page, in the frame without menus, and goes back there with 返回.
 */
@Component({
  selector: 'app-profile',
  imports: [Art, Button, Card, EditRow, EditSheet, IconButton, LineIcon, RouterLink],
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
                @if (editingInPlace()) {
                  <app-edit-row
                    [value]="me.name"
                    label="名字"
                    [validate]="nameHint"
                    [error]="serverError()"
                    [saving]="saving()"
                    (save)="save($event)"
                    (cancelled)="stopEditing()"
                  />
                } @else {
                  <div class="flex items-center gap-1">
                    <p class="text-base font-bold">{{ me.name }}</p>
                    <button
                      type="button"
                      appIconButton
                      aria-label="改名字"
                      (click)="startEditing()"
                    >
                      <app-line-icon name="pencil" />
                    </button>
                  </div>
                }
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
      </div>

      <app-edit-sheet
        [open]="editing() && inputMode.touch()"
        title="改名字"
        [value]="me.name"
        label="名字"
        [validate]="nameHint"
        [error]="serverError()"
        [saving]="saving()"
        (save)="save($event)"
        (cancelled)="stopEditing()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Profile {
  protected readonly session = inject(Session);
  protected readonly inputMode = inject(InputMode);
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);

  protected readonly nameHint = nameHint;
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly editingInPlace = computed(() => this.editing() && !this.inputMode.touch());

  protected startEditing(): void {
    this.serverError.set(null);
    this.editing.set(true);
  }

  protected stopEditing(): void {
    this.editing.set(false);
  }

  protected async save(name: string): Promise<void> {
    this.saving.set(true);
    this.serverError.set(null);
    try {
      const me = await this.api.send('PATCH', '/api/me', { name: name.trim() }, meResponseSchema);
      this.session.replace(me);
      this.editing.set(false);
      this.toaster.show('已保存', 'success', 'party');
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async logout(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.session.logout();
    } catch (error) {
      this.showFailure(error);
      this.signingOut.set(false);
    }
  }

  /**
   * A rejected name shows its hint under the box; any other failure (the
   * server failing or not answering, a request from another site) shows the
   * 出了点问题 toast.
   */
  private showFailure(error: unknown): void {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      return;
    }
    const field =
      error instanceof ApiError && error.code === 'invalid_request'
        ? error.fields.find((rejected) => rejected.path === 'name')
        : undefined;
    if (field) {
      this.serverError.set(NAME_HINTS[field.code]);
      return;
    }
    this.toaster.show('出了点问题，请稍后再试', 'error', 'wrench');
  }
}
