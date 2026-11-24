import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

/** The product name, the whole title of the product home and the home page. */
export const PRODUCT_NAME = '好奇星球';

/** The browser title of a page, "<page> - 好奇星球"; without a page, the product name alone. */
export function pageTitle(page?: string): string {
  return page ? `${page} - ${PRODUCT_NAME}` : PRODUCT_NAME;
}

/** Browser titles of the routes, from each route's own title (`pageTitle`). */
@Injectable({ providedIn: 'root' })
export class PageTitle extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(pageTitle(this.buildTitle(snapshot)));
  }
}
