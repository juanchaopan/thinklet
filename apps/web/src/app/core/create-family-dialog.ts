import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  NAME_MAX_LENGTH,
  characterCount,
  familyDetailSchema,
  familyNameSchema,
  type FamilyDetail,
} from '@thinklet/contracts';
import { Button } from '../shared/ui/button';
import { Dialog } from '../shared/ui/dialog';
import { TextField } from '../shared/ui/edit-field';
import { fieldHint, type FieldHints } from '../shared/ui/field-hint';
import { TimeZoneField } from '../shared/ui/time-zone-picker';
import { BrowserTimeZone } from '../shared/ui/time-zones';
import { Toaster } from '../shared/ui/toast';
import { Api, ApiError } from './api';
import { CurrentFamily } from './current-family';
import { FamilyCreation } from './family-creation';
import { Session } from './session';

/** The hints for a family name that cannot be saved (rules.md, 家庭). */
const NAME_HINTS: FieldHints = {
  required: '请填家庭名称',
  too_long: '家庭名称最多 20 个字',
  invalid: '请填家庭名称',
};

const TIME_ZONE_HINT = '请选择时区';

/** The hint for a family name that fails the shared name rule, or null when it may be saved. */
export function familyNameHint(value: string): string | null {
  return fieldHint(familyNameSchema, NAME_HINTS, value);
}

/** The name a new family starts with: "<the parent's name>的家", unless that is too long. */
export function suggestedFamilyName(parentName: string): string {
  const name = `${parentName}的家`;
  return characterCount(name) <= NAME_MAX_LENGTH ? name : '';
}

/**
 * The dialog that creates a family, over whatever page asked for it (the
 * start page, or 创建家庭 in the family menu). The name starts as
 * "<name>的家" and the time zone as the browser's own; both are checked
 * before anything is sent. The new family becomes the current one, and the
 * parent lands on its home page with 已创建「<name>」.
 */
@Component({
  selector: 'app-create-family-dialog',
  imports: [Button, Dialog, TextField, TimeZoneField],
  template: `
    <app-dialog
      [open]="creation.requested()"
      title="创建家庭"
      icon="seedling"
      size="large"
      (dismissed)="cancel()"
    >
      <form class="mt-6 flex flex-col gap-5" (submit)="create($event)">
        <div>
          <span aria-hidden="true" class="block text-sm font-bold">家庭名称</span>
          <app-text-field
            class="mt-2 block"
            label="家庭名称"
            [value]="name()"
            (valueChange)="editName($event)"
            [error]="nameError()"
            [attempt]="attempt()"
            [autofocus]="false"
          />
        </div>
        <app-time-zone-field
          [value]="timeZone()"
          (valueChange)="chooseTimeZone($event)"
          [error]="timeZoneError()"
        />
      </form>
      <button type="button" appButton="secondary" appDialogAction (click)="cancel()">取消</button>
      <button type="button" appButton appDialogAction [disabled]="saving()" (click)="create()">
        {{ saving() ? '创建中…' : '创建' }}
      </button>
    </app-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateFamilyDialog {
  protected readonly creation = inject(FamilyCreation);
  private readonly session = inject(Session);
  private readonly currentFamily = inject(CurrentFamily);
  private readonly browserTimeZone = inject(BrowserTimeZone);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);

  protected readonly name = signal('');
  protected readonly timeZone = signal<string | null>(null);
  protected readonly nameError = signal<string | null>(null);
  protected readonly timeZoneError = signal<string | null>(null);
  protected readonly attempt = signal(0);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      if (this.creation.requested()) {
        untracked(() => this.start());
      }
    });
  }

  protected editName(name: string): void {
    this.name.set(name);
    this.nameError.set(null);
  }

  protected chooseTimeZone(timeZone: string | null): void {
    this.timeZone.set(timeZone);
    this.timeZoneError.set(null);
  }

  protected cancel(): void {
    this.creation.done();
  }

  protected async create(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.saving()) {
      return;
    }
    const timezone = this.timeZone();
    this.nameError.set(familyNameHint(this.name()));
    this.timeZoneError.set(timezone ? null : TIME_ZONE_HINT);
    if (this.nameError() || !timezone) {
      this.attempt.update((count) => count + 1);
      return;
    }
    this.saving.set(true);
    try {
      const family = await this.api.send(
        'POST',
        '/api/families',
        { name: this.name().trim(), timezone },
        familyDetailSchema,
      );
      this.created(family);
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.saving.set(false);
    }
  }

  private start(): void {
    this.name.set(suggestedFamilyName(this.session.me()?.name ?? ''));
    this.timeZone.set(this.browserTimeZone.current());
    this.nameError.set(null);
    this.timeZoneError.set(null);
    this.attempt.set(0);
    this.saving.set(false);
  }

  /**
   * The parent is the admin of the new family, which joins the end of their
   * families and becomes the current one; its home page opens.
   */
  private created(family: FamilyDetail): void {
    const me = this.session.me();
    if (me) {
      this.session.replace({
        ...me,
        families: [
          ...me.families,
          { id: family.id, name: family.name, role: 'admin', pendingRequests: 0 },
        ],
      });
    }
    this.currentFamily.select(family.id);
    this.creation.done();
    void this.router.navigateByUrl('/');
    this.toaster.show(`已创建「${family.name}」`, 'success', 'party');
  }

  /**
   * A field the server turns down shows its hint, like the checks before
   * sending; anything else (the server failing or not answering) is a
   * toast, and what was typed stays.
   */
  private showFailure(error: unknown): void {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      return;
    }
    const fields =
      error instanceof ApiError && error.code === 'invalid_request' ? error.fields : [];
    const name = fields.find((field) => field.path === 'name');
    const timeZone = fields.find((field) => field.path === 'timezone');
    if (!name && !timeZone) {
      this.toaster.show('出了点问题，请稍后再试', 'error', 'wrench');
      return;
    }
    this.nameError.set(name ? NAME_HINTS[name.code] : null);
    this.timeZoneError.set(timeZone ? TIME_ZONE_HINT : null);
    this.attempt.update((count) => count + 1);
  }
}
