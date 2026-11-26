/**
 * The element that holds a book's grades within `container`: the line
 * “四年级～初二 · 编程” of a book's card, or the grade pill of a book page.
 */
export function gradeHolder(container: Element): HTMLElement {
  const holder = container.querySelector('app-grade-range')?.parentElement;
  if (!holder) {
    throw new Error('No grades of a book here');
  }
  return holder;
}
