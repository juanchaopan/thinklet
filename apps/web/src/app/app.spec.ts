import { render } from '@testing-library/angular';
import { expectNoAxeViolations } from '../testing/accessibility';
import { expectScreenshotsAtEverySize } from '../testing/screenshots';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  it('renders the home page at / and shows nothing', async () => {
    const { fixture, navigate } = await render(App, { routes });

    await navigate('/');
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-home')).not.toBeNull();
    expect(host.textContent?.trim()).toBe('');
    await expectNoAxeViolations(host);
    await expectScreenshotsAtEverySize('app-shell-home');
  });
});
