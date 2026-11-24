import { convertToParamMap } from '@angular/router';
import type { BookFiltersResponse } from '@thinklet/contracts';
import {
  WHOLE_LIBRARY,
  addressOf,
  chosenText,
  queryFromAddress,
  sameQuery,
  searchOf,
  toggled,
  withKnownChild,
  withinOptions,
} from './library-query';

const OPTIONS: BookFiltersResponse = {
  grades: [
    { id: 'preschool', name: '学前' },
    { id: 'grade-1', name: '一年级' },
    { id: 'grade-2', name: '二年级' },
  ],
  subjects: [
    { id: 'chinese', name: '语文' },
    { id: 'math', name: '数学' },
  ],
};

const CHILD = '3f9b2c1d-4e5a-4b6c-8d7e-9f0a1b2c3d00';

describe('queryFromAddress', () => {
  it('reads repeated grades and subjects once each, and the scope', () => {
    expect(
      queryFromAddress(
        convertToParamMap({
          grade: ['grade-1', 'grade-2', 'grade-1'],
          subject: 'math',
          scope: 'family',
        }),
      ),
    ).toEqual({ grades: ['grade-1', 'grade-2'], subjects: ['math'], scope: 'family', child: null });
  });

  it('reads a child scope with its child', () => {
    expect(queryFromAddress(convertToParamMap({ scope: 'child', child: CHILD }))).toEqual({
      ...WHOLE_LIBRARY,
      scope: 'child',
      child: CHILD,
    });
  });

  it('takes an unknown scope, or a child scope without a child, as the library', () => {
    expect(queryFromAddress(convertToParamMap({ scope: 'shelf' }))).toEqual(WHOLE_LIBRARY);
    expect(queryFromAddress(convertToParamMap({ scope: 'child' }))).toEqual(WHOLE_LIBRARY);
  });
});

describe('addressOf and searchOf', () => {
  it('leave out every filter that takes in all', () => {
    expect(addressOf(WHOLE_LIBRARY)).toEqual({});
    expect(searchOf(WHOLE_LIBRARY, { subjects: true })).toBe('');
  });

  it('write the grades, the subjects and the scope with its child', () => {
    const query = {
      grades: ['grade-1', 'grade-2'],
      subjects: ['math'],
      scope: 'child' as const,
      child: CHILD,
    };

    expect(addressOf(query)).toEqual({
      grade: ['grade-1', 'grade-2'],
      subject: ['math'],
      scope: 'child',
      child: CHILD,
    });
    expect(searchOf(query, { subjects: true })).toBe(
      `?grade=grade-1&grade=grade-2&subject=math&scope=child&child=${CHILD}`,
    );
    expect(searchOf(query, { subjects: false })).toBe(
      `?grade=grade-1&grade=grade-2&scope=child&child=${CHILD}`,
    );
  });
});

describe('withKnownChild', () => {
  it('keeps the scope of one of the family’s children', () => {
    const query = { ...WHOLE_LIBRARY, scope: 'child' as const, child: CHILD };

    expect(withKnownChild(query, [CHILD])).toBe(query);
  });

  it('takes the scope of a child the family does not have as the library', () => {
    expect(
      withKnownChild({ ...WHOLE_LIBRARY, grades: ['grade-1'], scope: 'child', child: CHILD }, []),
    ).toEqual({ ...WHOLE_LIBRARY, grades: ['grade-1'] });
  });
});

describe('withinOptions', () => {
  it('keeps the grades and subjects offered, in their order, and drops the rest', () => {
    expect(
      withinOptions(
        {
          ...WHOLE_LIBRARY,
          grades: ['grade-2', 'grade-9', 'preschool'],
          subjects: ['coding', 'math'],
        },
        OPTIONS,
      ),
    ).toEqual({ ...WHOLE_LIBRARY, grades: ['preschool', 'grade-2'], subjects: ['math'] });
  });
});

describe('sameQuery', () => {
  it('compares the filters and the scope', () => {
    expect(sameQuery(WHOLE_LIBRARY, { ...WHOLE_LIBRARY })).toBe(true);
    expect(sameQuery(WHOLE_LIBRARY, { ...WHOLE_LIBRARY, grades: ['grade-1'] })).toBe(false);
    expect(sameQuery(WHOLE_LIBRARY, { ...WHOLE_LIBRARY, scope: 'family' })).toBe(false);
  });
});

describe('chosenText', () => {
  it('says 全部, the names of one or two, and the count from three', () => {
    expect(chosenText([])).toBe('全部');
    expect(chosenText(['一年级'])).toBe('一年级');
    expect(chosenText(['一年级', '二年级'])).toBe('一年级、二年级');
    expect(chosenText(['学前', '一年级', '二年级'])).toBe('3 个');
  });
});

describe('toggled', () => {
  it('adds an id in the options’ order, and takes out one that is there', () => {
    expect(toggled(['grade-2'], 'preschool', OPTIONS.grades)).toEqual(['preschool', 'grade-2']);
    expect(toggled(['preschool', 'grade-2'], 'grade-2', OPTIONS.grades)).toEqual(['preschool']);
  });
});
