import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { BookFiltersResponse, BookScope, Child } from '@thinklet/contracts';
import { Art, type IconArt } from '../../shared/ui/art';
import { Avatar } from '../../shared/ui/avatar';
import { InputMode } from '../../shared/ui/input-mode';
import { LineIcon } from '../../shared/ui/line-icon';
import { FilterPopover } from './filter-popover';
import { chosenText, namesOf, type LibraryQuery } from './library-query';

/** One of the three filters. */
type Filter = 'grade' | 'subject' | 'scope';

/** A scope as the parent picks it: the library, the family's books or one child's. */
export interface ScopeChoice {
  readonly scope: BookScope;
  readonly child: string | null;
}

/** A scope as its menu lists it: its name, and its picture or the child's avatar. */
interface ScopeEntry extends ScopeChoice {
  readonly name: string;
  readonly art: IconArt | null;
}

/** How many tiles make a row of the grades. */
const GRADES_PER_ROW = 3;

/**
 * The library's three filters (rules.md, 筛选; look.md, 书): 年级 and 学科,
 * each taking any number of values, and the scope: 书库, 我家的书 or one of
 * the family's children. Each is a white pill saying what it lets through,
 * tinted once it narrows the books, and ringed while its options are open;
 * screen readers hear the scope's pill as 范围：<scope>. The grades are tiles
 * three to a row, so each school stage has a row and the grade left over
 * starts the first one alone; the subjects, the ones with books under the
 * other two filters, are tiles two to a row; a tile applies as it is
 * pressed, and a chosen tile is tinted with the violet tick. The scopes are
 * one to a row, each with its picture or the child's avatar, the children
 * after a line; choosing one closes them.
 *
 * The filters only say what was chosen; the page applies it.
 */
@Component({
  selector: 'app-library-filters',
  imports: [Art, Avatar, FilterPopover, LineIcon],
  host: { class: 'flex flex-wrap gap-2' },
  template: `
    <button
      #gradeButton
      type="button"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open() === 'grade'"
      [class]="buttonClasses('grade', query().grades.length > 0)"
      (click)="open.set('grade')"
    >
      年级：{{ gradeText() }}<app-line-icon name="chevron" class="text-ink-muted" />
    </button>
    <app-filter-popover
      class="contents"
      label="年级"
      width="grade"
      [open]="open() === 'grade'"
      [origin]="gradeButton"
      [dropDown]="!inputMode.touch()"
      [multiple]="true"
      (dismissed)="open.set(null)"
      (cleared)="grades.emit(null)"
    >
      <div class="grid grid-cols-3 gap-1.5">
        @for (grade of options().grades; track grade.id; let index = $index) {
          <button
            type="button"
            role="checkbox"
            class="flex min-h-11 items-center gap-1 rounded-xl border px-2.5 text-sm font-bold"
            [class]="tileClasses(query().grades.includes(grade.id), index === firstFullRow())"
            [attr.aria-checked]="query().grades.includes(grade.id)"
            (click)="grades.emit(grade.id)"
          >
            <span class="min-w-0 flex-1 text-left">{{ grade.name }}</span>
            @if (query().grades.includes(grade.id)) {
              <app-line-icon name="check" class="text-violet" />
            }
          </button>
        }
      </div>
    </app-filter-popover>

    <button
      #subjectButton
      type="button"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open() === 'subject'"
      [class]="buttonClasses('subject', query().subjects.length > 0)"
      (click)="open.set('subject')"
    >
      学科：{{ subjectText() }}<app-line-icon name="chevron" class="text-ink-muted" />
    </button>
    <app-filter-popover
      class="contents"
      label="学科"
      width="subject"
      [open]="open() === 'subject'"
      [origin]="subjectButton"
      [dropDown]="!inputMode.touch()"
      [multiple]="true"
      (dismissed)="open.set(null)"
      (cleared)="subjects.emit(null)"
    >
      <div class="grid grid-cols-2 gap-1.5">
        @for (subject of options().subjects; track subject.id) {
          <button
            type="button"
            role="checkbox"
            class="flex min-h-11 items-center gap-1 rounded-xl border px-3 font-bold"
            [class]="tileClasses(query().subjects.includes(subject.id), false)"
            [attr.aria-checked]="query().subjects.includes(subject.id)"
            (click)="subjects.emit(subject.id)"
          >
            <span class="min-w-0 flex-1 text-left">{{ subject.name }}</span>
            @if (query().subjects.includes(subject.id)) {
              <app-line-icon name="check" class="text-violet" />
            }
          </button>
        }
      </div>
    </app-filter-popover>

    <button
      #scopeButton
      type="button"
      aria-haspopup="dialog"
      [attr.aria-label]="'范围：' + scopeText()"
      [attr.aria-expanded]="open() === 'scope'"
      [class]="buttonClasses('scope', query().scope !== 'library')"
      (click)="open.set('scope')"
    >
      {{ scopeText() }}<app-line-icon name="chevron" class="text-ink-muted" />
    </button>
    <app-filter-popover
      class="contents"
      label="范围"
      width="scope"
      [open]="open() === 'scope'"
      [origin]="scopeButton"
      [dropDown]="!inputMode.touch()"
      (dismissed)="open.set(null)"
    >
      <div role="radiogroup" aria-label="范围" class="flex flex-col">
        @for (entry of scopes(); track entry.child ?? entry.scope; let index = $index) {
          @if (index === 2) {
            <div aria-hidden="true" class="my-1 border-t border-line"></div>
          }
          <button
            type="button"
            role="radio"
            class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left font-bold"
            [class]="isChosen(entry) ? 'bg-tint' : 'hover:bg-canvas'"
            [attr.aria-checked]="isChosen(entry)"
            (click)="choose(entry)"
          >
            @if (entry.art; as art) {
              <img alt="" [appArt]="art" class="size-7" />
            } @else if (entry.child; as child) {
              <app-avatar [name]="entry.name" [personId]="child" size="mark" />
            }
            <span class="min-w-0 truncate">{{ entry.name }}</span>
            @if (isChosen(entry)) {
              <app-line-icon name="check" class="ml-auto text-violet" />
            }
          </button>
        }
      </div>
    </app-filter-popover>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryFilters {
  /** What the library shows, as the filter options and the family's children take it. */
  readonly query = input.required<LibraryQuery>();
  readonly options = input.required<BookFiltersResponse>();
  readonly children = input.required<readonly Child[]>();

  /** A grade pressed, or null for 清除. */
  readonly grades = output<string | null>();
  /** A subject pressed, or null for 清除. */
  readonly subjects = output<string | null>();
  readonly scope = output<ScopeChoice>();

  protected readonly inputMode = inject(InputMode);
  protected readonly open = signal<Filter | null>(null);

  /** 书库 with the cabin, 我家的书 with the heart-shaped house, then each child. */
  protected readonly scopes = computed<ScopeEntry[]>(() => [
    { scope: 'library', child: null, name: '书库', art: 'home' },
    { scope: 'family', child: null, name: '我家的书', art: 'family' },
    ...this.children().map(({ id, nickname }) => ({
      scope: 'child' as const,
      child: id,
      name: nickname,
      art: null,
    })),
  ]);

  protected readonly gradeText = computed(() =>
    chosenText(namesOf(this.query().grades, this.options().grades)),
  );
  protected readonly subjectText = computed(() =>
    chosenText(namesOf(this.query().subjects, this.options().subjects)),
  );
  protected readonly scopeText = computed(
    () => this.scopes().find((entry) => this.isChosen(entry))?.name ?? '书库',
  );

  /**
   * The index of the grade that starts the first full row of three; the
   * grades left over stand alone on the row before it. -1 when the grades
   * fill their rows.
   */
  protected readonly firstFullRow = computed(
    () => this.options().grades.length % GRADES_PER_ROW || -1,
  );

  protected buttonClasses(filter: Filter, narrowed: boolean): string {
    const base =
      'inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-bold whitespace-nowrap transition-colors duration-100 sm:gap-1.5 sm:px-4';
    if (this.open() === filter) {
      return `${base} border-violet bg-surface ring-2 ring-violet/20`;
    }
    return narrowed
      ? `${base} border-violet/40 bg-tint text-ink`
      : `${base} border-line-strong bg-surface hover:bg-canvas`;
  }

  protected tileClasses(chosen: boolean, startsRow: boolean): string {
    const state = chosen ? 'border-violet/30 bg-tint' : 'border-line hover:bg-canvas';
    return startsRow ? `${state} col-start-1` : state;
  }

  protected isChosen(entry: ScopeChoice): boolean {
    const { scope, child } = this.query();
    return entry.scope === scope && entry.child === child;
  }

  /** Picks a scope and closes the scopes. */
  protected choose({ scope, child }: ScopeChoice): void {
    this.open.set(null);
    this.scope.emit({ scope, child });
  }
}
