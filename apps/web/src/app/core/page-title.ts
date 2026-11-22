import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

/** The product name, the whole title of the product home and the home page. */
export const PRODUCT_NAME = '好奇星球';

/** Browser titles read "<page> - 好奇星球"; a route without a title shows the product name alone. */
@Injectable({ providedIn: 'root' })
export class PageTitle extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page ? `${page} - ${PRODUCT_NAME}` : PRODUCT_NAME);
  }
}
