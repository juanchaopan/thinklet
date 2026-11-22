import type { IconArt } from '../../shared/ui/art';

/** A page of the parent's own, outside any family. */
export interface ParentPage {
  readonly label: string;
  readonly icon: IconArt;
  readonly link: string;
}

/**
 * The parent's own pages (rules.md, 导航): joining another family, with the
 * red dot for request results not yet seen, and the parent's settings. The
 * sidebar lists them under the parent's name; the avatar's menu holds them
 * below 1024 px and on the pages without a family.
 */
export const PARENT_PAGES: readonly ParentPage[] = [
  { label: '加入家庭', icon: 'key', link: '/join' },
  { label: '个人设置', icon: 'consent', link: '/profile' },
];
