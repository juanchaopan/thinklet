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
import { chosenText, namesOf, type FilterOption, type LibraryQuery } from './library-query';

/** One of the three filters. */
type Filter = 'grade' | 'subject' | 'scope';

/** A filter that takes any number of values: 年级 or 学科. */
type ManyFilter = Exclude<Filter, 'scope'>;

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

/** 年级 or 学科 as its pill and its tiles show it. */
interface ManyFilterView {
  readonly filter: ManyFilter;
  readonly label: string;
  /** What the pill says the filter lets through. */
  readonly text: string;
  readonly chosen: readonly string[];
  readonly options: readonly FilterOption[];
  /** The grid's columns. */
  readonly columns: string;
  /** The tiles' padding and text size. */
  readonly tile: string;
  /** The index of the tile that starts a row of its own; -1 for none. */
  readonly rowStart: number;
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
    @for (view of manyFilters(); track view.filter) {
      <button
        #filterButton
        type="button"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open() === view.filter"
        [class]="buttonClasses(view.filter, view.chosen.length > 0)"
        (click)="open.set(view.filter)"
      >
        {{ view.label }}：{{ view.text }}<app-line-icon name="chevron" class="text-ink-muted" />
      </button>
      <app-filter-popover
        class="contents"
        [label]="view.label"
        [width]="view.filter"
        [open]="open() === view.filter"
        [origin]="filterButton"
        [dropDown]="!inputMode.touch()"
        [multiple]="true"
        (dismissed)="open.set(null)"
        (cleared)="pick(view.filter, null)"
      >
        <div class="grid gap-1.5" [class]="view.columns">
          @for (option of view.options; track option.id; let index = $index) {
            @let ticked = view.chosen.includes(option.id);
            <button
              type="button"
              role="checkbox"
              class="flex min-h-11 items-center gap-1 rounded-xl border font-bold"
              [class]="tileClasses(view.tile, ticked, index === view.rowStart)"
              [attr.aria-checked]="ticked"
              (click)="pick(view.filter, option.id)"
            >
              <span class="min-w-0 flex-1 text-left">{{ option.name }}</span>
              @if (ticked) {
                <app-line-icon name="check" class="text-violet" />
              }
            </button>
          }
        </div>
      </app-filter-popover>
    }

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

  /**
   * 年级 and 学科. The grades are three to a row, the grades left over
   * standing alone on the row before the first full one; the subjects are
   * two to a row.
   */
  protected readonly manyFilters = computed<ManyFilterView[]>(() => {
    const { grades, subjects } = this.query();
    const options = this.options();
    return [
      {
        filter: 'grade',
        label: '年级',
        text: chosenText(namesOf(grades, options.grades)),
        chosen: grades,
        options: options.grades,
        columns: 'grid-cols-3',
        tile: 'px-2.5 text-sm',
        rowStart: options.grades.length % GRADES_PER_ROW || -1,
      },
      {
        filter: 'subject',
        label: '学科',
        text: chosenText(namesOf(subjects, options.subjects)),
        chosen: subjects,
        options: options.subjects,
        columns: 'grid-cols-2',
        tile: 'px-3',
        rowStart: -1,
      },
    ];
  });

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

  protected readonly scopeText = computed(
    () => this.scopes().find((entry) => this.isChosen(entry))?.name ?? '书库',
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

  protected tileClasses(tile: string, chosen: boolean, startsRow: boolean): string {
    const state = chosen ? 'border-violet/30 bg-tint' : 'border-line hover:bg-canvas';
    return startsRow ? `${tile} ${state} col-start-1` : `${tile} ${state}`;
  }

  /** A grade or a subject pressed, or null for 清除. */
  protected pick(filter: ManyFilter, id: string | null): void {
    if (filter === 'grade') {
      this.grades.emit(id);
    } else {
      this.subjects.emit(id);
    }
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
