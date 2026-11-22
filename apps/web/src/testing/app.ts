import type { Provider } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import { render } from '@testing-library/angular';
import { App } from '../app/app';
import { provideApp } from '../app/app.config';
import { PageNavigation } from '../app/core/login';

export interface RenderAppOptions {
  /** Routes to use instead of the app's own, e.g. to place a component in the signed-in frame. */
  routes?: Routes;
  providers?: Provider[];
}

/**
 * Renders the whole app as the browser gets it, with the app's own
 * providers, opens `url` and waits until the page has settled (guards, lazy
 * pages, api calls). Deferred parts load when their trigger fires, as in the
 * browser. Full-page navigations (signing in and out) are recorded in
 * `navigations` instead of leaving the test page.
 */
export async function renderApp(url: string, options: RenderAppOptions = {}) {
  const navigations: string[] = [];
  const result = await render(App, {
    providers: [
      ...provideApp(options.routes),
      { provide: PageNavigation, useValue: { go: (target: string) => navigations.push(target) } },
      ...(options.providers ?? []),
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  await result.fixture.whenStable();
  return { ...result, router, navigations };
}
