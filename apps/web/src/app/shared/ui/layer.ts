import {
  createGlobalPositionStrategy,
  createNoopScrollStrategy,
  createOverlayRef,
  type OverlayConfig,
  type OverlayRef,
} from '@angular/cdk/overlay';
import type { TemplatePortal } from '@angular/cdk/portal';
import { signal, type Injector } from '@angular/core';

/** Dialogs, sheets and menus leave in 150 ms (look.md). */
export const LEAVE_DURATION = 150;

/**
 * A layer covering the whole screen, for a dialog or a sheet with its
 * backdrop. The page behind keeps its scroll position and scrollbar, so
 * nothing under the backdrop moves.
 */
export function fullScreenLayer(injector: Injector): OverlayConfig {
  return {
    positionStrategy: createGlobalPositionStrategy(injector).top('0').left('0'),
    scrollStrategy: createNoopScrollStrategy(),
    width: '100%',
    height: '100%',
  };
}

/**
 * Something shown above the page on the CDK overlay: a dialog, a sheet or a
 * menu. Hiding it first sets `leaving`, so its template can play the leaving
 * animation, and removes it when that animation is over.
 */
export class Layer {
  readonly leaving = signal(false);

  private overlayRef: OverlayRef | undefined;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly injector: Injector) {}

  /**
   * Shows the template, unless it is shown already. A layer that is leaving
   * is replaced. `onBackdropClick` runs when a configured backdrop is clicked.
   */
  show(portal: TemplatePortal, config: OverlayConfig, onBackdropClick?: () => void): void {
    if (this.overlayRef && !this.leaving()) {
      return;
    }
    this.remove();
    this.overlayRef = createOverlayRef(this.injector, config);
    this.overlayRef.attach(portal);
    if (onBackdropClick) {
      this.overlayRef.backdropClick().subscribe(onBackdropClick);
    }
  }

  /** Plays the leaving animation, then removes the layer. */
  hide(): void {
    if (!this.overlayRef || this.leaving()) {
      return;
    }
    this.leaving.set(true);
    this.leaveTimer = setTimeout(() => this.remove(), LEAVE_DURATION);
  }

  /** Removes the layer at once. */
  remove(): void {
    clearTimeout(this.leaveTimer);
    this.overlayRef?.dispose();
    this.overlayRef = undefined;
    this.leaving.set(false);
  }
}
