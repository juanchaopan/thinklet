import { render, screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { errorNumber, PageProblem } from './page-problem';

describe('errorNumber', () => {
  it('takes the first 8 characters of the request id in two groups of four', () => {
    expect(errorNumber('a1f392c0-5b7d-4e9f-8a1b-2c3d4e5f6a7b')).toBe('a1f3-92c0');
  });

  it('skips the hyphens of an id whose first group is shorter', () => {
    expect(errorNumber('a1f3-92c0e5')).toBe('a1f3-92c0');
  });

  it('shows a short id whole', () => {
    expect(errorNumber('a1f3')).toBe('a1f3');
  });
});

describe('PageProblem', () => {
  it('says the family is not there and leads back', async () => {
    const action = vi.fn();
    await render(PageProblem, { inputs: { kind: 'not-found' }, on: { action } });

    expect(screen.getByRole('heading', { name: '找不到这个家庭' })).toBeTruthy();
    expect(screen.getByText('它不存在，或者你已经不是成员。')).toBeTruthy();
    expect(screen.queryByText(/错误编号/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '回到我的家庭' }));

    expect(action).toHaveBeenCalledOnce();
    await expectNoAxeViolations();
  });

  it('says the page did not open, with the error number, and retries', async () => {
    const action = vi.fn();
    await render(PageProblem, {
      inputs: { kind: 'server', requestId: 'a1f392c0-5b7d-4e9f-8a1b-2c3d4e5f6a7b' },
      on: { action },
    });

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText('出了点问题，请稍后再试。')).toBeTruthy();
    expect(screen.getByText('错误编号 a1f3-92c0')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(action).toHaveBeenCalledOnce();
  });

  it('shows no error number without a request id', async () => {
    await render(PageProblem, { inputs: { kind: 'server' } });

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.queryByText(/错误编号/)).toBeNull();
  });
});
