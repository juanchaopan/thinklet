import { render } from '@testing-library/angular';
import { expectNoAxeViolations, heardText, seenText } from '../../../testing/accessibility';
import { GradeRange, gradeWords, type GradeSpan } from './grade-range';

const PRESCHOOL = { id: 'preschool', name: '学前' };
const GRADE_1 = { id: 'grade-1', name: '一年级' };
const GRADE_4 = { id: 'grade-4', name: '四年级' };
const GRADE_8 = { id: 'grade-8', name: '初二' };

/** Shows the grades and returns the component's own element. */
async function renderGrades(grades: GradeSpan): Promise<Element> {
  const { container } = await render(GradeRange, { inputs: { grades } });
  return container;
}

describe('gradeWords', () => {
  it('writes and says one grade by its name', () => {
    expect(gradeWords({ minGrade: GRADE_1, maxGrade: GRADE_1 })).toEqual({
      shown: '一年级',
      spoken: '一年级',
    });
  });

  it('writes a range with the full-width tilde and says it with 到', () => {
    expect(gradeWords({ minGrade: GRADE_4, maxGrade: GRADE_8 })).toEqual({
      shown: '四年级～初二',
      spoken: '四年级到初二',
    });
    expect(gradeWords({ minGrade: PRESCHOOL, maxGrade: GRADE_1 })).toEqual({
      shown: '学前～一年级',
      spoken: '学前到一年级',
    });
  });

  it('never writes a dash, which would run into the 一 of 一年级', () => {
    expect(gradeWords({ minGrade: GRADE_1, maxGrade: GRADE_8 }).shown).not.toMatch(/[-‐–—]/);
  });
});

describe('GradeRange', () => {
  it('shows one grade as plain text, the same to the eye and to screen readers', async () => {
    const host = await renderGrades({ minGrade: GRADE_1, maxGrade: GRADE_1 });

    expect(host.textContent.trim()).toBe('一年级');
    expect(host.querySelector('[aria-hidden]')).toBeNull();
    expect(host.querySelector('.sr-only')).toBeNull();
  });

  it('shows a range with the tilde and has screen readers say it with 到', async () => {
    const host = await renderGrades({ minGrade: GRADE_4, maxGrade: GRADE_8 });

    expect(seenText(host)).toBe('四年级～初二');
    expect(heardText(host)).toBe('四年级到初二');
    await expectNoAxeViolations(host);
  });
});
