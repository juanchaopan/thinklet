import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FAMILY_NAME_HINTS, familyNameHint } from '../../core/create-family-dialog';
import { IconButton } from '../../shared/ui/button';
import { EditRow, EditSheet } from '../../shared/ui/edit-field';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { FamilyStore } from './family-store';

/**
 * The head of the family page: 家庭管理 over the family's name. The admin
 * renames the family with the pencil, in place with a mouse (the name gives
 * way to 家庭名称 and the text box with 取消 and 保存) and in a sheet titled
 * 改家庭名称 on a touch screen, as the parent's own name is changed. The
 * name is checked before it is sent; a saved name says 已保存.
 */
@Component({
  selector: 'app-family-name',
  imports: [EditRow, EditSheet, IconButton, LineIcon],
  host: { class: 'block' },
  template: `
    @if (store.family(); as family) {
      <header class="flex flex-col gap-1">
        <p class="text-sm font-bold text-ink-muted">家庭管理</p>
        @if (editingInPlace()) {
          <div class="flex flex-col gap-2">
            <p aria-hidden="true" class="text-sm font-bold text-ink-muted">家庭名称</p>
            <app-edit-row
              [value]="family.name"
              label="家庭名称"
              [validate]="nameHint"
              [error]="serverError()"
              [saving]="store.busy() === 'name'"
              (save)="save($event)"
              (cancelled)="stop()"
            />
          </div>
        } @else {
          <div class="flex items-center gap-1">
            <h1 class="text-3xl font-black">{{ family.name }}</h1>
            @if (store.admin()) {
              <button type="button" appIconButton aria-label="改家庭名称" (click)="start()">
                <app-line-icon name="pencil" />
              </button>
            }
          </div>
        }
      </header>
      <app-edit-sheet
        [open]="editingInSheet()"
        title="改家庭名称"
        [value]="family.name"
        label="家庭名称"
        [validate]="nameHint"
        [error]="serverError()"
        [saving]="store.busy() === 'name'"
        (save)="save($event)"
        (cancelled)="stop()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FamilyName {
  protected readonly store = inject(FamilyStore);
  protected readonly inputMode = inject(InputMode);

  protected readonly nameHint = familyNameHint;
  protected readonly editing = signal(false);
  protected readonly serverError = signal<string | null>(null);

  /** Editing goes on only while the parent is still the admin. */
  private readonly editingAsAdmin = computed(() => this.editing() && this.store.admin());

  protected readonly editingInPlace = computed(
    () => this.editingAsAdmin() && !this.inputMode.touch(),
  );
  protected readonly editingInSheet = computed(
    () => this.editingAsAdmin() && this.inputMode.touch(),
  );

  protected start(): void {
    this.serverError.set(null);
    this.editing.set(true);
  }

  protected stop(): void {
    this.editing.set(false);
  }

  /** Saves the name; a name the server turns down shows its hint, other failures a toast. */
  protected async save(name: string): Promise<void> {
    this.serverError.set(null);
    const result = await this.store.update({ name: name.trim() });
    if (result.outcome === 'saved') {
      this.editing.set(false);
    } else if (result.outcome === 'rejected') {
      this.serverError.set(FAMILY_NAME_HINTS[result.code]);
    }
  }
}
