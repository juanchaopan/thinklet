import { render } from '@testing-library/angular';
import { expectNoAxeViolations } from '../../../testing/accessibility';
import { expectScreenshotsAtEverySize } from '../../../testing/screenshots';
import { Home } from './home';

describe('Home', () => {
  it('shows nothing', async () => {
    const { container } = await render(Home);

    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
    await expectNoAxeViolations(container as Element);
    await expectScreenshotsAtEverySize('home-blank');
  });
});
