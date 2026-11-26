import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { GradeRef } from '@thinklet/contracts';

/** The grades a book is written for: the lowest and the highest, the same grade for one grade. */
export interface GradeSpan {
  readonly minGrade: Readonly<GradeRef>;
  readonly maxGrade: Readonly<GradeRef>;
}

/**
 * A book's grades as the page writes them and as screen readers say them,
 * and whether they are a range of several grades rather than one grade.
 */
export interface GradeWords {
  readonly isRange: boolean;
  readonly shown: string;
  readonly spoken: string;
}

/**
 * A book's grades in words (rules.md, 年级的写法): one grade is its name,
 * several are “<lowest>～<highest>” with the full-width tilde, since a dash
 * would run into the 一 of 一年级 or 初一. Screen readers read the tilde as
 * a symbol or skip it, so they are given “<lowest>到<highest>”. Whether the
 * grades are a range follows their ids, which name a grade, not their names.
 */
export function gradeWords({ minGrade, maxGrade }: GradeSpan): GradeWords {
  if (minGrade.id === maxGrade.id) {
    return { isRange: false, shown: minGrade.name, spoken: minGrade.name };
  }
  return {
    isRange: true,
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
    @if (words().isRange) {
      <span aria-hidden="true">{{ words().shown }}</span>
      <span class="sr-only">{{ words().spoken }}</span>
    } @else {
      {{ words().shown }}
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GradeRange {
  readonly grades = input.required<GradeSpan>();

  protected readonly words = computed(() => gradeWords(this.grades()));
}
