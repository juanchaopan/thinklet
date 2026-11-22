/**
 * Keeps what a page shows from going back in time. Reads of the same data
 * can answer in any order, and a read that started before a change made on
 * this page can answer after the change's own answer is shown. A read's
 * answer is shown only while nothing newer has happened since it started:
 * no read started after it, and no change was shown after it. A slow answer
 * then never puts older data back.
 *
 * Each store keeps one of these for the data it shows.
 */
export class FreshReads {
  private generation = 0;

  /** Starts a read; the check it returns says whether the read's answer may still be shown. */
  start(): () => boolean {
    const started = ++this.generation;
    return () => started === this.generation;
  }

  /** Marks what is shown as newer than every read started so far, as a change's answer is. */
  wrote(): void {
    this.generation++;
  }
}
