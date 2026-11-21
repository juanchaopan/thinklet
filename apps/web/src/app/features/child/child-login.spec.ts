import { screen } from '@testing-library/angular';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { renderApp } from '../../../testing/app';
import { stubVisitor } from '../../../testing/sample-data';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';

describe('ChildLogin', () => {
  beforeEach(() => {
    stubVisitor();
  });

  it('greets the child with the rabbit teacher and says the way in is coming', async () => {
    await renderApp('/child');

    expect(document.title).toBe('孩子登录 - 好奇星球');
    expect(screen.getByRole('heading', { level: 1, name: '孩子登录' })).toBeTruthy();
    expect(screen.getByText('马上就来，再等等小兔老师哦！')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    await expectNoAxeViolations();
    await expectScreenshotsAtEverySize('child-login');
  });

  it('goes back to the product home', async () => {
    const { router, fixture } = await renderApp('/child');

    await userEvent.click(screen.getByRole('link', { name: '回到首页' }));
    await fixture.whenStable();

    expect(router.url).toBe('/');
    expect(screen.getByRole('link', { name: '家长登录 / 注册' })).toBeTruthy();
  });
});
