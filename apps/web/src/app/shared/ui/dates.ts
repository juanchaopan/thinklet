interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** The format that splits a moment into its parts in the time zone; UTC for a zone the browser does not know. */
function formatIn(timeZone: string): Intl.DateTimeFormat {
  let format = dateFormats.get(timeZone);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    };
    try {
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    }
    dateFormats.set(timeZone, format);
  }
  return format;
}

/** The year, month, day, hour and minute of a moment in a time zone. */
function partsIn(moment: Date, timeZone: string): DateParts {
  const parts = new Map(
    formatIn(timeZone)
      .formatToParts(moment)
      .map((part) => [part.type, Number(part.value)]),
  );
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? 0;
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

export interface DateOptions {
  /** Adds the time of day, 24-hour, as in "11月18日 09:12". */
  withTime?: boolean;
  /** The moment that counts as now, which decides whether the year is written. */
  now?: Date;
}

/**
 * A moment written the one fixed way (rules.md, 日期和时间), in the given
 * time zone: "11月18日" within this year there, "2025年11月18日" for another
 * year, and with the time "11月18日 09:12". There are no words such as 今天.
 * A time zone the browser does not know is read as UTC.
 */
export function formatDate(
  value: string | Date,
  timeZone: string,
  { withTime = false, now = new Date() }: DateOptions = {},
): string {
  const moment = partsIn(new Date(value), timeZone);
  const year = moment.year === partsIn(now, timeZone).year ? '' : `${String(moment.year)}年`;
  const date = `${year}${String(moment.month)}月${String(moment.day)}日`;
  return withTime ? `${date} ${twoDigits(moment.hour)}:${twoDigits(moment.minute)}` : date;
}
