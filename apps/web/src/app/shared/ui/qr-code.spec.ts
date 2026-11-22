import { create } from 'qrcode';
import { darkRuns } from './qr-code';

const LINK = 'https://thinklet.example/join/7KQ4MZ';

/** The dark modules of the QR code of the text, as "x,y" in module units without the quiet zone. */
function darkModules(text: string): Set<string> {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const dark = new Set<string>();
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) {
        dark.add(`${String(x)},${String(y)}`);
      }
    }
  }
  return dark;
}

describe('darkRuns', () => {
  it('covers exactly the dark modules of the code, inside a quiet zone of four modules', () => {
    const { span, runs } = darkRuns(LINK);
    const covered = new Set(
      runs.flatMap(({ x, y, width }) =>
        Array.from({ length: width }, (_, step) => `${String(x + step - 4)},${String(y - 4)}`),
      ),
    );

    expect(covered).toEqual(darkModules(LINK));
    expect(span).toBe(create(LINK, { errorCorrectionLevel: 'M' }).modules.size + 8);
  });

  it('joins neighbouring dark modules of a row into one run', () => {
    const { runs } = darkRuns(LINK);

    expect(runs.some(({ width }) => width >= 7)).toBe(true);
    expect(new Set(runs.map(({ x, y }) => `${String(x)},${String(y)}`)).size).toBe(runs.length);
  });
});
