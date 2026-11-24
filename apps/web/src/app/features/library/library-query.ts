import type { Params, ParamMap } from '@angular/router';
import type { BookFiltersResponse, BookScope } from '@thinklet/contracts';

/**
 * What the library is asked to show (rules.md, 筛选): the grades and the
 * subjects chosen, none meaning all of them, and the scope, with the child
 * of the `child` scope. The address keeps it as the api's query does:
 * `grade` and `subject` repeated, `scope=family`, or `scope=child` with
 * `child=<id>`; the library's own scope is the address without them.
 */
export interface LibraryQuery {
  readonly grades: readonly string[];
  readonly subjects: readonly string[];
  readonly scope: BookScope;
  readonly child: string | null;
}

/** A grade or a subject among the filter options. */
export type FilterOption = BookFiltersResponse['grades'][number];

/** Every grade and subject of the whole library: no filter at all. */
export const WHOLE_LIBRARY: LibraryQuery = {
  grades: [],
  subjects: [],
  scope: 'library',
  child: null,
};

/** The query the address asks for; a scope it does not know, or `child` without a child, is the library. */
export function queryFromAddress(params: ParamMap): LibraryQuery {
  const grades = [...new Set(params.getAll('grade'))];
  const subjects = [...new Set(params.getAll('subject'))];
  const scope = params.get('scope');
  const child = params.get('child');
  if (scope === 'family') {
    return { grades, subjects, scope, child: null };
  }
  if (scope === 'child' && child) {
    return { grades, subjects, scope, child };
  }
  return { grades, subjects, scope: 'library', child: null };
}

/** The address's query parameters for the query, leaving out every filter that takes in all. */
export function addressOf(query: LibraryQuery): Params {
  const params: Params = {};
  if (query.grades.length > 0) {
    params['grade'] = [...query.grades];
  }
  if (query.subjects.length > 0) {
    params['subject'] = [...query.subjects];
  }
  if (query.scope !== 'library') {
    params['scope'] = query.scope;
  }
  if (query.scope === 'child' && query.child) {
    params['child'] = query.child;
  }
  return params;
}

/** What the api's query string holds besides the grades and the scope. */
export interface SearchParts {
  /** Whether the subjects go in. */
  readonly subjects: boolean;
  /** Where a batch of the books starts, when it is not the first. */
  readonly cursor?: string | null;
}

/**
 * The api's query string of the query, `?grade=…&scope=…`, encoded as the
 * address is (`addressOf`): the grades, the subjects when `include.subjects`
 * asks for them, the scope with its child and then the cursor when there
 * is one; empty for the whole library's first batch.
 */
export function searchOf(query: LibraryQuery, include: SearchParts): string {
  const search = new URLSearchParams();
  const params = addressOf(include.subjects ? query : { ...query, subjects: [] });
  for (const [name, value] of Object.entries(params)) {
    for (const each of [value as string | string[]].flat()) {
      search.append(name, each);
    }
  }
  if (include.cursor) {
    search.append('cursor', include.cursor);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * The query with its scope as the family has it: the scope of a child who
 * is not, or no longer, one of the family's children is the library.
 */
export function withKnownChild(query: LibraryQuery, childIds: readonly string[]): LibraryQuery {
  if (query.scope === 'child' && (query.child === null || !childIds.includes(query.child))) {
    return { ...query, scope: 'library', child: null };
  }
  return query;
}

/** The chosen ids among the options, in the options' order. */
function among(chosen: readonly string[], options: readonly FilterOption[]): string[] {
  return options.filter(({ id }) => chosen.includes(id)).map(({ id }) => id);
}

/**
 * The query as the filter options take it: the grades that exist and the
 * subjects offered under the other two filters, each in the options' order.
 * An unknown grade or a subject without books is no part of the filter, so
 * a filter of only such values takes in everything.
 */
export function withinOptions(query: LibraryQuery, options: BookFiltersResponse): LibraryQuery {
  return {
    ...query,
    grades: among(query.grades, options.grades),
    subjects: among(query.subjects, options.subjects),
  };
}

/** Whether two queries ask for the same books. */
export function sameQuery(first: LibraryQuery, second: LibraryQuery): boolean {
  return (
    first.scope === second.scope &&
    first.child === second.child &&
    first.grades.join(',') === second.grades.join(',') &&
    first.subjects.join(',') === second.subjects.join(',')
  );
}

/** The names of the chosen ids, in the options' order. */
export function namesOf(chosen: readonly string[], options: readonly FilterOption[]): string[] {
  return options.filter(({ id }) => chosen.includes(id)).map(({ name }) => name);
}

/**
 * What a filter's button says it lets through: 全部 when nothing is chosen,
 * the names themselves for one or two, and the count from three on, as in
 * “一年级、二年级” and “3 个”.
 */
export function chosenText(names: readonly string[]): string {
  if (names.length === 0) {
    return '全部';
  }
  return names.length <= 2 ? names.join('、') : `${String(names.length)} 个`;
}

/** The ids with `id` added, or taken out when it is there already, in the options' order. */
export function toggled(
  chosen: readonly string[],
  id: string,
  options: readonly FilterOption[],
): string[] {
  const next = chosen.includes(id) ? chosen.filter((other) => other !== id) : [...chosen, id];
  return among(next, options);
}
