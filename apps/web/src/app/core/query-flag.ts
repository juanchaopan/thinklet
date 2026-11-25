import { computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';

/** A query parameter that opens something over a page while it has one value. */
export interface QueryFlag {
  /** The page's whole query, for the other parameters that come with the flag. */
  readonly query: Signal<ParamMap>;
  /** Whether the parameter has the value now. */
  readonly on: Signal<boolean>;
  /** Takes the parameter out of the address, in place of the current history entry. */
  clear(): void;
}

/**
 * The query parameter `name` of the current route as a flag that is on
 * while it is `value`, such as the notice dialogs that open over a page
 * the browser lands on. Called where `inject` works.
 */
export function queryFlag(name: string, value: string): QueryFlag {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  const query = toSignal(route.queryParamMap, { requireSync: true });
  return {
    query,
    on: computed(() => query().get(name) === value),
    clear: () => {
      void router.navigate([], {
        relativeTo: route,
        queryParams: { [name]: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    },
  };
}
