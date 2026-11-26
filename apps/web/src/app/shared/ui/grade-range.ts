import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The grades a book is written for: the lowest and the highest, the same grade for one grade. */
export interface GradeSpan {
  readonly minGrade: { readonly id: string; readonly name: string };
  readonly maxGrade: { readonly id: string; readonly name: string };
}

/** A book's grades as the page writes them and as screen readers say them. */
export interface GradeWords {
  readonly shown: string;
  readonly spoken: string;
}

/**
 * A book's grades in words (rules.md, 年级的写法): one grade is its name,
 * several are “<lowest>～<highest>” with the full-width tilde, since a dash
 * would run into the 一 of 一年级 or 初一. Screen readers read the tilde as
 * a symbol or skip it, so they are given “<lowest>到<highest>”.
 */
export function gradeWords({ minGrade, maxGrade }: GradeSpan): GradeWords {
  if (minGrade.id === maxGrade.id) {
    return { shown: minGrade.name, spoken: minGrade.name };
  }
  return {
    shown: `${minGrade.name}～${maxGrade.name}`,
    spoken: `${minGrade.name}到${maxGrade.name}`,
  };
}

/**
 * A book's grades written inline, as `gradeWords` puts them. A range shows
 * its written form to the eye only and its spoken form to screen readers
 * only; one grade is plain text for both.
 *
 *   <app-grade-range [grades]="book" /> · 数学
 */
@Component({
  selector: 'app-grade-range',
  template: `
    @if (words().shown === words().spoken) {
      {{ words().shown }}
    } @else {
      <span aria-hidden="true">{{ words().shown }}</span>
      <span class="sr-only">{{ words().spoken }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GradeRange {
  readonly grades = input.required<GradeSpan>();

  protected readonly words = computed(() => gradeWords(this.grades()));
}
