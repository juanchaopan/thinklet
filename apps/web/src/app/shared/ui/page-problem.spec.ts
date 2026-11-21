import { render, screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { PageProblem } from './page-problem';

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

  it('says the page did not open, with the error id, and retries', async () => {
    const action = vi.fn();
    await render(PageProblem, {
      inputs: { kind: 'server', requestId: 'a1f3-92c0' },
      on: { action },
    });

    expect(screen.getByRole('heading', { name: '页面没能打开' })).toBeTruthy();
    expect(screen.getByText('出了点问题，请稍后再试。')).toBeTruthy();
    expect(screen.getByText('错误编号 a1f3-92c0')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(action).toHaveBeenCalledOnce();
  });
});
