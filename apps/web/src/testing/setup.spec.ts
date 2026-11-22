import { HttpClient, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { delay, http, HttpResponse } from 'msw';
import { userEvent } from 'vitest/browser';
import { takeUnhandledApiRequests, worker } from './network';
import { nextFrames } from './pointer';

// The tests in each block run in order and depend on each other on purpose:
// the first leaves something behind, the second checks that it did not
// reach it.

/** A button that covers the whole screen, wherever the mouse is on it. */
function fullScreenButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = '整个屏幕';
  button.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(button);
  onTestFinished(() => {
    button.remove();
  });
  return button;
}

describe('the mouse between tests', () => {
  it('rests where a test moved it until the test ends', async () => {
    const button = fullScreenButton();

    await userEvent.hover(button);

    expect(button.matches(':hover')).toBe(true);
  });

  it('starts off the page in the next test', async () => {
    const button = fullScreenButton();
    await nextFrames();
    await nextFrames();

    expect(button.matches(':hover')).toBe(false);
  });
});

describe('api requests between tests', () => {
  it('answers a request still on its way when the test ends with that test’s stubs', () => {
    worker.use(
      http.get('/api/example', async () => {
        await delay(100);
        return HttpResponse.json({ answer: 42 });
      }),
    );
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });

    TestBed.inject(HttpClient).get('/api/example').subscribe();
  });

  it('leaves nothing from the test before for the next test', () => {
    expect(takeUnhandledApiRequests()).toEqual([]);
  });
});
