import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { render } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { boxValues, codeBoxes, typeCode } from '../../../testing/families';
import { CodeBoxes, codeSlots, familyCodeCharacters, filledCode } from './code-boxes';

describe('familyCodeCharacters', () => {
  it('makes small letters capitals', () => {
    expect(familyCodeCharacters('7kq4mz')).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
  });

  it('leaves out the characters a code never has: 0, O, 1, I, L and anything else', () => {
    expect(familyCodeCharacters('0O1Il-L 7K/Q·4\nMZ')).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
    expect(familyCodeCharacters('家庭码')).toEqual([]);
  });
});

describe('codeSlots', () => {
  it('fills the six boxes from the start, leaving the rest empty', () => {
    expect(codeSlots('7kq')).toEqual(['7', 'K', 'Q', '', '', '']);
    expect(codeSlots()).toEqual(['', '', '', '', '', '']);
  });

  it('takes no more than six characters', () => {
    expect(codeSlots('7KQ4MZH8P')).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
  });
});

describe('filledCode', () => {
  it('is the code when every box is filled, and null while one is empty', () => {
    expect(filledCode(['7', 'K', 'Q', '4', 'M', 'Z'])).toBe('7KQ4MZ');
    expect(filledCode(['7', 'K', '', '4', 'M', 'Z'])).toBeNull();
  });
});

@Component({
  imports: [CodeBoxes],
  template: `
    <app-code-boxes
      [(characters)]="characters"
      [error]="error()"
      [attempt]="attempt()"
      (completed)="completed.push($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  readonly characters = signal<readonly string[]>(codeSlots());
  readonly error = signal<string | null>(null);
  readonly attempt = signal(0);
  readonly completed: string[] = [];
}

async function renderBoxes(start = '') {
  const view = await render(Host, {
    componentProperties: { characters: signal<readonly string[]>(codeSlots(start)) },
  });
  return { ...view, host: view.fixture.componentInstance };
}

/** Waits until the focus is in the box at `index`. */
async function focusIn(index: number): Promise<void> {
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(codeBoxes()[index]);
  });
}

/** Pastes text into the focused box as the clipboard would. */
function paste(text: string): void {
  const data = new DataTransfer();
  data.setData('text', text);
  document.activeElement?.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
}

describe('CodeBoxes', () => {
  it('is a group of six boxes named for screen readers, the focus in the first', async () => {
    await renderBoxes();

    expect(codeBoxes().map((box) => box.getAttribute('aria-label'))).toEqual([
      '第 1 位',
      '第 2 位',
      '第 3 位',
      '第 4 位',
      '第 5 位',
      '第 6 位',
    ]);
    await focusIn(0);
    await expectNoAxeViolations();
  });

  it('moves on with every character, making small letters capitals', async () => {
    const { host } = await renderBoxes();

    await typeCode('7kq');

    expect(boxValues()).toEqual(['7', 'K', 'Q', '', '', '']);
    expect(host.characters()).toEqual(['7', 'K', 'Q', '', '', '']);
    expect(document.activeElement).toBe(codeBoxes()[3]);
  });

  it('takes no character outside the alphabet', async () => {
    await renderBoxes();

    await typeCode('0O1IL-7');

    expect(boxValues()).toEqual(['7', '', '', '', '', '']);
    expect(document.activeElement).toBe(codeBoxes()[1]);
  });

  it('gives the code once the last box is filled', async () => {
    const { host } = await renderBoxes();

    await typeCode('7KQ4M');
    expect(host.completed).toEqual([]);
    await userEvent.keyboard('z');

    expect(host.completed).toEqual(['7KQ4MZ']);
  });

  it('starts in the first empty box of a code begun elsewhere', async () => {
    await renderBoxes('7KQ');

    await focusIn(3);
  });

  it('goes back and clears the box before with Backspace in an empty box', async () => {
    await renderBoxes();

    await typeCode('7KQ');
    await userEvent.keyboard('{Backspace}');

    expect(boxValues()).toEqual(['7', 'K', '', '', '', '']);
    expect(document.activeElement).toBe(codeBoxes()[2]);
  });

  it('clears a filled box with Backspace and stays there', async () => {
    await renderBoxes('7KQ4MZ');
    await focusIn(5);

    await userEvent.keyboard('{Backspace}');

    expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', '']);
    expect(document.activeElement).toBe(codeBoxes()[5]);
  });

  it('replaces the character of a box it comes back to', async () => {
    const { host } = await renderBoxes('7KQ4MW');
    await focusIn(5);

    await userEvent.keyboard('z');

    expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
    expect(host.completed).toEqual(['7KQ4MZ']);
  });

  it('moves between the boxes with the arrow keys', async () => {
    await renderBoxes('7KQ');
    await focusIn(3);

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toBe(codeBoxes()[1]);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(codeBoxes()[2]);
  });

  it('fills every box from the first with a pasted code, wherever it is pasted', async () => {
    const { host } = await renderBoxes('9');
    await focusIn(1);

    paste(' 7kq-4mz ');

    await vi.waitFor(() => {
      expect(boxValues()).toEqual(['7', 'K', 'Q', '4', 'M', 'Z']);
    });
    expect(host.completed).toEqual(['7KQ4MZ']);
  });

  it('fills the boxes from where shorter text is pasted', async () => {
    await renderBoxes('7K');
    await focusIn(2);

    paste('q4');

    await vi.waitFor(() => {
      expect(boxValues()).toEqual(['7', 'K', 'Q', '4', '', '']);
    });
    expect(document.activeElement).toBe(codeBoxes()[4]);
  });

  it('turns red, shakes and says what is wrong under the boxes', async () => {
    const { host, fixture } = await renderBoxes('7KQ4MW');

    host.error.set('没有这个家庭码');
    host.attempt.set(1);
    await fixture.whenStable();

    const group = codeBoxes()[0]?.closest('[role="group"]');
    const described = group?.getAttribute('aria-describedby') ?? '';
    expect(group?.classList).toContain('animate-shake');
    expect(document.getElementById(described)?.textContent).toBe('没有这个家庭码');
    expect(codeBoxes().every((box) => box.getAttribute('aria-invalid') === 'true')).toBe(true);
    await expectNoAxeViolations();
  });
});
