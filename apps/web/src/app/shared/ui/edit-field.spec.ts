import { render, screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { childAccountText } from './child-account';
import { EditRow, EditSheet, TextField } from './edit-field';

const required = (value: string) => (value.trim() ? null : '请填家庭名称');

describe('TextField', () => {
  it('says under the box what it takes, until there is an error', async () => {
    const view = await render(TextField, {
      inputs: { value: '', label: '账号', hint: '只能用小写字母和数字', autofocus: false },
    });
    const box = screen.getByRole('textbox', { name: '账号' });

    expect(box.getAttribute('aria-describedby')).toBe(screen.getByText('只能用小写字母和数字').id);

    view.fixture.componentRef.setInput('error', '请填账号');
    await view.fixture.whenStable();

    expect(screen.queryByText('只能用小写字母和数字')).toBeNull();
    expect(box.getAttribute('aria-describedby')).toBe(screen.getByText('请填账号').id);
  });

  it('takes only what its filter lets through, with the caret after what was typed', async () => {
    const view = await render(TextField, {
      inputs: { value: '', label: '账号', filter: childAccountText },
    });
    const box = screen.getByRole<HTMLInputElement>('textbox', { name: '账号' });

    await userEvent.type(box, 'Le Le');
    box.setSelectionRange(2, 2);
    await userEvent.keyboard('-9');

    expect(box.value).toBe('le9le');
    expect(box.selectionStart).toBe(3);
    expect(view.fixture.componentInstance.value()).toBe('le9le');
    expect(box.getAttribute('autocapitalize')).toBe('off');
    expect(box.getAttribute('spellcheck')).toBe('false');
  });
});

describe('EditRow', () => {
  it('saves only a value that passes the check, and shakes otherwise', async () => {
    const save = vi.fn();
    await render(EditRow, {
      inputs: { value: '林悦的家', label: '家庭名称', validate: required },
      on: { save },
    });
    const box = screen.getByRole('textbox', { name: '家庭名称' });

    await userEvent.clear(box);
    await userEvent.keyboard('{Enter}');

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText('请填家庭名称')).toBeTruthy();
    expect(box.getAttribute('aria-describedby')).toBe(
      screen.getByText('请填家庭名称').getAttribute('id'),
    );
    await expectNoAxeViolations();

    await userEvent.type(box, '外婆家');
    expect(screen.queryByText('请填家庭名称')).toBeNull();
    await userEvent.keyboard('{Enter}');

    expect(save).toHaveBeenCalledWith('外婆家');
  });

  it('shows a message from the server and shakes', async () => {
    const view = await render(EditRow, {
      inputs: { value: '林悦的家', label: '家庭名称', validate: required, error: null },
    });

    view.fixture.componentRef.setInput('error', '家庭名称最多 20 个字');
    await view.fixture.whenStable();

    const box = screen.getByRole('textbox', { name: '家庭名称' });
    expect(screen.getByText('家庭名称最多 20 个字')).toBeTruthy();
    expect(box.classList).toContain('animate-shake');
  });

  it('cannot be saved twice while saving', async () => {
    const save = vi.fn();
    await render(EditRow, {
      inputs: { value: '林悦的家', label: '家庭名称', validate: required, saving: true },
      on: { save },
    });

    const button = screen.getByRole<HTMLButtonElement>('button', { name: '保存中…' });
    expect(button.disabled).toBe(true);
    await userEvent.keyboard('{Enter}');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('EditSheet', () => {
  it('edits in a sheet titled with what is changed', async () => {
    const save = vi.fn();
    const cancelled = vi.fn();
    await render(EditSheet, {
      inputs: {
        open: true,
        title: '改家庭名称',
        value: '林悦的家',
        label: '家庭名称',
        validate: required,
      },
      on: { save, cancelled },
    });

    const box = await screen.findByRole('textbox', { name: '家庭名称' });
    expect(screen.getByRole('dialog', { name: '改家庭名称' })).toBeTruthy();
    expect((box as HTMLInputElement).value).toBe('林悦的家');

    await userEvent.clear(box);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByText('请填家庭名称')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    await userEvent.type(box, '外婆家{Enter}');
    expect(save).toHaveBeenCalledWith('外婆家');

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
