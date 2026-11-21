import { provideHttpClient } from '@angular/common/http';
import {
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  type Routes,
} from '@angular/router';
import { routes } from './app.routes';
import { PageTitle } from './core/page-title';

/** Everything the app needs, with the given routes (the app's own unless a test places others). */
export function provideApp(appRoutes: Routes = routes): Array<Provider | EnvironmentProviders> {
  return [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    { provide: TitleStrategy, useClass: PageTitle },
  ];
}

export const appConfig: ApplicationConfig = { providers: provideApp() };
