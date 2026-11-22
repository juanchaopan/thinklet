import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  input,
  model,
  output,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FAMILY_CODE_ALPHABET, FAMILY_CODE_LENGTH } from '@thinklet/contracts';

let nextBoxesId = 0;

/**
 * The characters of a family code in typed or pasted text (rules.md, 输入家庭码):
 * small letters become capitals and anything outside the code's alphabet is
 * left out.
 */
export function familyCodeCharacters(text: string): string[] {
  return Array.from(text.toUpperCase()).filter((character) =>
    FAMILY_CODE_ALPHABET.includes(character),
  );
}

/** The six boxes filled from the start with the code's characters in the text; '' is an empty box. */
export function codeSlots(text = ''): string[] {
  const characters = familyCodeCharacters(text).slice(0, FAMILY_CODE_LENGTH);
  return Array.from({ length: FAMILY_CODE_LENGTH }, (_, index) => characters[index] ?? '');
}

/** The code the boxes hold, or null while one of them is empty. */
export function filledCode(slots: readonly string[]): string | null {
  return slots.length === FAMILY_CODE_LENGTH && slots.every(Boolean) ? slots.join('') : null;
}

/**
 * The family code typed into six boxes, one character each, like a
 * verification code. Small letters become capitals and characters outside
 * the code's alphabet are not taken. A typed character moves on to the next
 * box; Backspace in an empty box goes back to the one before and clears it.
 * Pasted text fills the boxes in order: a whole code from the first box,
 * anything shorter from the box it is pasted in. When an edit fills the last
 * empty box, `completed` gives the code.
 *
 * With an `error` the boxes turn red and the message shows under them; each
 * new `attempt` shakes them 6 px to each side in 300 ms. The first empty box
 * takes the focus when the boxes appear.
 */
@Component({
  selector: 'app-code-boxes',
  host: { class: 'block' },
  template: `
    <div
      #group
      role="group"
      aria-label="家庭码，6 位"
      [attr.aria-describedby]="error() ? errorId : null"
      class="grid grid-cols-6 gap-2 sm:gap-3"
    >
      @for (character of characters(); track $index; let index = $index) {
        <span class="relative block">
          <input
            #box
            type="text"
            [attr.aria-label]="'第 ' + (index + 1) + ' 位'"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.cdkFocusInitial]="index === firstEmpty() ? '' : null"
            [value]="character"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            class="peer block aspect-[4/5] w-full rounded-2xl border-2 text-center font-mono text-2xl font-black text-ink caret-transparent transition-colors duration-100 outline-none sm:text-3xl"
            [class]="boxClasses(character)"
            (focus)="box.select()"
            (input)="typed(index, box)"
            (keydown)="onKeydown(index, $event)"
            (paste)="pasted(index, $event)"
          />
          @if (!character) {
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 m-auto hidden h-7 w-0.5 animate-pulse bg-violet peer-focus:block"
            ></span>
          }
        </span>
      }
    </div>
    @if (error(); as message) {
      <p [id]="errorId" class="mt-3 animate-fade text-sm font-bold text-rose-ink">{{ message }}</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeBoxes {
  /** One character per box, '' for an empty box. */
  readonly characters = model.required<readonly string[]>();
  readonly error = input<string | null>(null);
  /** Counts the codes that were turned down; each new one shakes the boxes. */
  readonly attempt = input(0);

  readonly completed = output<string>();

  protected readonly errorId = `app-code-boxes-error-${String(nextBoxesId++)}`;

  protected readonly firstEmpty = computed(() => {
    const index = this.characters().findIndex((character) => !character);
    return index === -1 ? FAMILY_CODE_LENGTH - 1 : index;
  });

  private readonly group = viewChild.required<ElementRef<HTMLElement>>('group');
  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  constructor() {
    afterNextRender(() => {
      this.focusBox(this.firstEmpty());
    });
    effect(() => {
      if (this.attempt() > 0 && this.error()) {
        untracked(() => this.shake());
      }
    });
  }

  protected boxClasses(character: string): string {
    if (this.error()) {
      return 'border-rose-ink bg-rose/40';
    }
    const focus = 'focus:border-violet focus:bg-surface focus:ring-2 focus:ring-violet/20';
    return character ? `border-line-strong bg-surface ${focus}` : `border-line bg-canvas ${focus}`;
  }

  /**
   * What was typed into a box. The box held its own character, selected so
   * typing replaces it; whatever else arrives at once (autofill, a keyboard
   * that sends several characters) fills the boxes after it.
   */
  protected typed(index: number, box: HTMLInputElement): void {
    const previous = this.characters()[index] ?? '';
    let arrived = familyCodeCharacters(box.value);
    if (arrived.length > 1 && arrived[0] === previous) {
      arrived = arrived.slice(1);
    }
    if (arrived.length === 0) {
      box.value = previous;
      return;
    }
    this.fill(index, arrived);
  }

  protected onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const back = event.key === 'Backspace' && !this.characters()[index] && index > 0;
      const cleared = back ? index - 1 : index;
      this.update(cleared, []);
      this.focusBox(cleared);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      this.focusBox(index - 1);
    } else if (event.key === 'ArrowRight' && index < FAMILY_CODE_LENGTH - 1) {
      event.preventDefault();
      this.focusBox(index + 1);
    }
  }

  protected pasted(index: number, event: ClipboardEvent): void {
    event.preventDefault();
    const arrived = familyCodeCharacters(event.clipboardData?.getData('text') ?? '');
    if (arrived.length > 0) {
      this.fill(arrived.length >= FAMILY_CODE_LENGTH ? 0 : index, arrived);
    }
  }

  /** Puts the characters into the boxes from `index` on, then moves to the box after them. */
  private fill(index: number, arrived: readonly string[]): void {
    const taken = arrived.slice(0, FAMILY_CODE_LENGTH - index);
    this.update(index, taken);
    this.focusBox(Math.min(index + taken.length, FAMILY_CODE_LENGTH - 1));
    const code = filledCode(this.characters());
    if (code) {
      this.completed.emit(code);
    }
  }

  /**
   * Writes `arrived` from `index` on, or clears the box at `index` when
   * nothing arrived. The boxes show the new characters at once, before the
   * next render, so a key pressed right after reads what is really there.
   */
  private update(index: number, arrived: readonly string[]): void {
    const next = [...this.characters()];
    if (arrived.length === 0) {
      next[index] = '';
    }
    arrived.forEach((character, offset) => {
      next[index + offset] = character;
    });
    this.characters.set(next);
    this.boxes().forEach((box, position) => {
      box.nativeElement.value = next[position] ?? '';
    });
  }

  private focusBox(index: number): void {
    this.boxes()[index]?.nativeElement.focus();
  }

  private shake(): void {
    const group = this.group().nativeElement;
    group.classList.remove('animate-shake');
    // Reading the layout restarts the animation when the class comes back.
    group.getBoundingClientRect();
    group.classList.add('animate-shake');
  }
}
