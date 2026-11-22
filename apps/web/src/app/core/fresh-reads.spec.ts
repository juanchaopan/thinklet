import { FreshReads } from './fresh-reads';

describe('FreshReads', () => {
  it('lets the answer of the only read be shown', () => {
    const reads = new FreshReads();

    const fresh = reads.start();

    expect(fresh()).toBe(true);
  });

  it('lets only the answer of the read started last be shown, whatever order they answer in', () => {
    const reads = new FreshReads();

    const older = reads.start();
    const newer = reads.start();

    expect(newer()).toBe(true);
    expect(older()).toBe(false);
  });

  it('shows no answer of a read started before a change was shown', () => {
    const reads = new FreshReads();

    const before = reads.start();
    reads.wrote();
    const after = reads.start();

    expect(before()).toBe(false);
    expect(after()).toBe(true);
  });
});
