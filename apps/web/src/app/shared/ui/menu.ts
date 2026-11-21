import { FocusKeyManager, type FocusableOption } from '@angular/cdk/a11y';
import {
  createFlexibleConnectedPositionStrategy,
  createRepositionScrollStrategy,
  type OverlayConfig,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  ViewContainerRef,
  afterNextRender,
  contentChildren,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { SHEET_FRAME } from './dialog';
import { Layer, fullScreenLayer } from './layer';

/**
 * One entry of a menu. `current` marks the entry that is chosen now.
 *
 *   <button type="button" appMenuItem (click)="…">…</button>
 */
@Directive({
  selector: 'button[appMenuItem], a[appMenuItem]',
  host: {
    role: 'menuitem',
    class:
      'flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base hover:bg-canvas',
    '[class.bg-tint]': 'current()',
  },
})
export class MenuItem implements FocusableOption {
  readonly current = input(false);

  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  focus(): void {
    this.element.focus();
  }
}

/** A line between groups of menu entries. */
@Directive({
  selector: '[appMenuDivider]',
  host: { role: 'separator', class: 'my-2 block border-t border-line' },
})
export class MenuDivider {}

/**
 * A menu of actions opened from a button. As a drop-down it unfolds 4 px
 * below its button in 150 ms; otherwise it is a sheet rising from the bottom
 * over a dimmed page in 300 ms, floating above the bottom edge on a touch
 * screen. The owner chooses with `dropDown`: the mouse version drops down
 * where there is room under the button.
 *
 * The first entry takes the focus; the arrow keys, Home and End move between
 * entries. Escape, Tab and a click outside emit `dismissed`; the owner then
 * sets `open` to false, and the focus goes back to the button.
 */
@Component({
  selector: 'app-menu',
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #entries><ng-content /></ng-template>

    <ng-template #dropDownFrame>
      <div
        role="menu"
        tabindex="-1"
        [attr.aria-label]="label()"
        class="w-72 origin-top-left rounded-3xl border border-line bg-surface p-2 shadow-pop outline-none"
        [class]="layer.leaving() ? 'animate-drop-out' : 'animate-drop'"
        (keydown)="onKeydown($event)"
      >
        <ng-container [ngTemplateOutlet]="entries" />
      </div>
    </ng-template>

    <ng-template #sheetFrame>
      <div class="fixed inset-0 flex items-end justify-center {{ sheetSpacing }}">
        <div
          aria-hidden="true"
          tabindex="-1"
          class="absolute inset-0 bg-ink/45"
          [class]="layer.leaving() ? 'animate-fade-out' : 'animate-fade'"
          (click)="dismissed.emit()"
        ></div>
        <div
          class="relative w-full max-w-sheet rounded-t-sheet bg-surface p-2 pb-6 touch:rounded-sheet touch:pb-2"
          [class]="layer.leaving() ? sheetLeave : sheetEnter"
        >
          <div
            role="menu"
            tabindex="-1"
            [attr.aria-label]="label()"
            class="p-2 outline-none"
            (keydown)="onKeydown($event)"
          >
            <ng-container [ngTemplateOutlet]="entries" />
          </div>
        </div>
      </div>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Menu {
  readonly open = input.required<boolean>();
  /** The menu's name for screen readers. */
  readonly label = input.required<string>();
  /** The button the menu belongs to; a drop-down unfolds below it. */
  readonly origin = input.required<HTMLElement>();
  readonly dropDown = input(true);

  readonly dismissed = output();

  protected readonly sheetSpacing = SHEET_FRAME;
  protected readonly sheetEnter = 'animate-sheet touch:animate-float';
  protected readonly sheetLeave = 'animate-sheet-out touch:animate-float-out';
  protected readonly layer: Layer;

  private readonly items = contentChildren(MenuItem, { descendants: true });
  private readonly dropDownFrame = viewChild<TemplateRef<unknown>>('dropDownFrame');
  private readonly sheetFrame = viewChild<TemplateRef<unknown>>('sheetFrame');
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private shown = false;

  constructor() {
    const viewContainer = inject(ViewContainerRef);
    this.layer = new Layer(this.injector);
    effect(() => {
      const dropDown = this.dropDown();
      const frame = dropDown ? this.dropDownFrame() : this.sheetFrame();
      const open = this.open();
      if (!frame) {
        return;
      }
      untracked(() => {
        if (open) {
          this.show(new TemplatePortal(frame, viewContainer), dropDown);
        } else {
          this.hide();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.layer.remove();
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      this.dismissed.emit();
      return;
    }
    const items = this.items();
    const keys = new FocusKeyManager(items).withWrap().withHomeAndEnd();
    keys.updateActiveItem(items.findIndex((item) => item.element === this.document.activeElement));
    keys.onKeydown(event);
    keys.destroy();
  }

  private show(portal: TemplatePortal, dropDown: boolean): void {
    this.shown = true;
    this.layer.show(portal, this.config(dropDown), () => {
      this.dismissed.emit();
    });
    afterNextRender(() => this.items()[0]?.focus(), { injector: this.injector });
  }

  /** Closes the menu; the focus goes back to its button unless it has moved elsewhere. */
  private hide(): void {
    if (!this.shown) {
      return;
    }
    this.shown = false;
    const focused = this.document.activeElement;
    const inside = this.items().some((item) => item.element === focused);
    this.layer.hide();
    if (inside || focused === this.document.body) {
      this.origin().focus();
    }
  }

  private config(dropDown: boolean): OverlayConfig {
    if (!dropDown) {
      return fullScreenLayer(this.injector);
    }
    return {
      positionStrategy: createFlexibleConnectedPositionStrategy(
        this.injector,
        this.origin(),
      ).withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
      ]),
      scrollStrategy: createRepositionScrollStrategy(this.injector),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    };
  }
}
