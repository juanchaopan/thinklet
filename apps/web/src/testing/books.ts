import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { screen, within } from '@testing-library/angular';
import type { ErrorCode, MeResponse } from '@thinklet/contracts';
import { http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { renderApp } from './app';
import { dialogGone } from './family-page';
import { LINYUE_AS_DRAWN } from './library';
import { worker } from './network';
import { nextFrames } from './pointer';
import { ERROR_NUMBER, errorBody, stubSignedIn } from './sample-data';

// What the tests of the library and of a book page do with the family's
// books: open a page as 林悦, choose who reads a book, answer a question,
// look at what reached the api and make its next answer fail.

/** Longer than any opening, so a menu or a dialog held there is fully open. */
export const OPEN = 1000;

/** The family's children in the order they were added. */
export const NICKNAMES = ['小明', '朵朵', '乐乐'];

/** Opens the app at the address as 林悦, with the counts the design draws on the library. */
export async function renderAsLinyue(url: string, me: MeResponse = LINYUE_AS_DRAWN) {
  stubSignedIn(me);
  return renderApp(url);
}

/** Whether each of the family's children is ticked in 谁能读 or the scopes. */
export function ticks(options: HTMLElement, role: 'checkbox' | 'radio'): Array<string | null> {
  return NICKNAMES.map((name) =>
    within(options).getByRole(role, { name }).getAttribute('aria-checked'),
  );
}

/** Opens 谁能读 for the book with the title, with the button of that name. */
export async function openReaders(button: string | RegExp, title: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: button }));
  return screen.findByRole('dialog', { name: `谁能读《${title}》` });
}

/** The row of a child in 谁能读. */
export function childRow(dialog: HTMLElement, nickname: string): HTMLElement {
  return within(dialog).getByRole('checkbox', { name: nickname });
}

/**
 * Opens 谁能读 for the book with the button of that name, presses the rows
 * of the children and 确定; returns the dialog.
 */
export async function changeReaders(
  button: string | RegExp,
  title: string,
  nicknames: readonly string[],
): Promise<HTMLElement> {
  const dialog = await openReaders(button, title);
  for (const nickname of nicknames) {
    await userEvent.click(childRow(dialog, nickname));
  }
  await userEvent.click(within(dialog).getByRole('button', { name: '确定' }));
  return dialog;
}

/**
 * Opens 谁能读 for the book with the button of that name, ticks 乐乐 and
 * leaves with 取消, once the dialog has gone.
 */
export async function tickLeleAndCancel(button: string | RegExp, title: string): Promise<void> {
  const dialog = await openReaders(button, title);
  await userEvent.click(childRow(dialog, '乐乐'));
  await cancel(dialog, `谁能读《${title}》`);
}

/**
 * Checks 谁能读 of an inactive book read by 小明 alone: he can be taken off,
 * 朵朵 cannot be given it, and the dialog says why.
 */
export function expectNobodyNew(dialog: HTMLElement): void {
  expect(within(dialog).getByText('下架的书不能再分派')).toBeTruthy();
  expect(childRow(dialog, '小明').hasAttribute('disabled')).toBe(false);
  expect(childRow(dialog, '朵朵').hasAttribute('disabled')).toBe(true);
}

/**
 * With the keyboard alone, in 谁能读 of a book read by 小明 and 朵朵: goes
 * from 小明, where the dialog put the focus, to 乐乐, ticks him, and
 * presses 确定.
 */
export async function addLeleWithKeyboard(dialog: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(childRow(dialog, '小明'));
  });
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.keyboard(' ');
  await userEvent.tab();
  await userEvent.tab();
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '确定' }));
  await userEvent.keyboard('{Enter}');
}

/** Presses 取消 in the dialog with the name and waits until it has gone. */
export async function cancel(dialog: HTMLElement, name: string | RegExp): Promise<void> {
  await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await dialogGone(name);
}

/**
 * With the keyboard alone, in a question: goes from 取消, where the dialog
 * put the focus, to the action and presses it.
 */
export async function confirmWithKeyboard(dialog: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '取消' }));
  });
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
}

/** Checks that the page says it did not open, with the error number, and presses 重试. */
export async function retryPageThatFailed(): Promise<void> {
  expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
  expect(screen.getByText(new RegExp(ERROR_NUMBER))).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  await settled();
}

/** Records the bodies of the calls to an address and lets the fake library answer them. */
export function spyOn(method: 'put' | 'delete', path: string): unknown[] {
  const bodies: unknown[] = [];
  worker.use(
    http[method](path, async ({ request }) => {
      const text = await request.clone().text();
      bodies.push(text ? JSON.parse(text) : null);
      return undefined;
    }),
  );
  return bodies;
}

/** Answers the next call to an address once with the error. */
export function failNext(
  method: 'get' | 'put' | 'delete',
  path: string,
  status: number,
  code: ErrorCode = 'internal',
): void {
  worker.use(
    http[method](path, () => HttpResponse.json(errorBody(code), { status }), { once: true }),
  );
}

/**
 * Shows the top of the page behind a dialog or a sheet, as the design draws
 * it, whatever the browser scrolled into view to press a button or kept in
 * view when the screen changed size.
 */
export async function pageAtTop(): Promise<void> {
  window.scrollTo(0, 0);
  await nextFrames();
}

/** Lets the app finish what it started. */
export async function settled(): Promise<void> {
  await TestBed.inject(ApplicationRef).whenStable();
}

/** Whether a toast is on screen. */
export function anyToast(): boolean {
  return (document.querySelector('app-toast-outlet')?.childElementCount ?? 0) > 0;
}
