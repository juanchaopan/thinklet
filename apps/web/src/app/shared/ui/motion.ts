/**
 * Dialogs, sheets, menus and toasts leave in 150 ms (look.md, 动画).
 *
 * It has a module of its own, free of the CDK overlay, so the toasts that
 * every page can show take the duration without pulling the overlay into
 * the first bundle; only the pages that open a dialog or a menu load it.
 */
export const LEAVE_DURATION = 150;
