import { DOCUMENT, Injectable, inject } from '@angular/core';

/** The invitation link of a family code: `<this site>/join/<code>` (rules.md, 分享家庭码). */
export function invitationLink(origin: string, code: string): string {
  return `${origin}/join/${code}`;
}

/** The words a parent shares to invite someone into the family (rules.md, 分享家庭码). */
export function invitationText(
  parentName: string,
  familyName: string,
  code: string,
  link: string,
): string {
  return `${parentName}邀请你加入「${familyName}」，在好奇星球上输入家庭码 ${code}，或者打开这个链接：${link}`;
}

/**
 * The system's share sheet, where the browser has one (phones and tablets
 * mostly; some desktop browsers and in-app browsers such as WeChat's have
 * none). Tests replace it.
 */
@Injectable({ providedIn: 'root' })
export class ShareSheet {
  private readonly navigator = inject(DOCUMENT).defaultView?.navigator;

  /** Whether the browser can open its share sheet with the text. */
  canShare(text: string): boolean {
    const navigator = this.navigator;
    if (typeof navigator?.share !== 'function') {
      return false;
    }
    return typeof navigator.canShare !== 'function' || navigator.canShare({ text });
  }

  /**
   * Opens the share sheet with the text. It resolves once something was
   * shared, and rejects with an `AbortError` when the parent closes the
   * sheet without sharing.
   */
  share(text: string): Promise<void> {
    if (!this.navigator) {
      return Promise.reject(new Error('There is no browser to share from'));
    }
    return this.navigator.share({ text });
  }
}
