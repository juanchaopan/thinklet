import { Injectable } from '@angular/core';

/** Offsets west of UTC are written with a true minus sign, as in "UTC−05:00". */
const MINUS = '−';

/**
 * Zones IANA has renamed whose old names browsers still report: their time
 * zone data comes from CLDR, which keeps the first name a zone had. Each old
 * name is an alias of the new one, so the zone is shown, saved and compared
 * by the new name everywhere.
 */
const RENAMED: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** A time zone as the pickers list it. */
export interface TimeZoneOption {
  /** The standard IANA name. */
  readonly id: string;
  /** The UTC offset at the moment the list was made, in minutes east of UTC. */
  readonly offsetMinutes: number;
  /** The offset as shown: "UTC+08:00", "UTC−05:00". */
  readonly offset: string;
  /** The zone as it is shown everywhere: "Asia/Shanghai（UTC+08:00）". */
  readonly label: string;
}

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The standard names already worked out, by the name asked for. A browser's
 * zone data does not change while the page is open, and building a
 * formatter for each of its few hundred zones every time the picker opens
 * is slow on a phone.
 */
const canonicalNames = new Map<string, string | null>();

/** The offset of the zone at `moment` as Intl writes it ("GMT", "GMT+08:00", "GMT-05:00"). */
function offsetName(id: string, moment: Date): string | undefined {
  let format = offsetFormats.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'longOffset' });
    offsetFormats.set(id, format);
  }
  return format.formatToParts(moment).find((part) => part.type === 'timeZoneName')?.value;
}

/** The name the browser resolves the zone to, by the new name when IANA renamed it. */
function resolveTimeZone(name: string): string | null {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return RENAMED[resolved] ?? resolved;
}

/**
 * The standard name of a time zone: aliases the browser knows become the
 * name it resolves them to, and the old names in RENAMED become the new
 * ones. Null when the browser does not know the zone at all.
 */
export function canonicalTimeZone(name: string): string | null {
  let id = canonicalNames.get(name);
  if (id === undefined) {
    id = resolveTimeZone(name);
    canonicalNames.set(name, id);
  }
  return id;
}

/** The zone with its offset at `moment`, or null when the browser cannot work out its offset. */
export function timeZoneOption(id: string, moment: Date): TimeZoneOption | null {
  let name: string | undefined;
  try {
    name = offsetName(id, moment);
  } catch {
    return null;
  }
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? '');
  if (!match) {
    return null;
  }
  const [, sign = '+', hours = '00', minutes = '00'] = match;
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  const offset = `UTC${sign === '-' ? MINUS : '+'}${hours}:${minutes}`;
  return { id, offsetMinutes, offset, label: `${id}（${offset}）` };
}

/** The zone as it is shown now, with its offset; the bare name when the browser cannot work that out. */
export function timeZoneLabel(id: string): string {
  return timeZoneOption(id, new Date())?.label ?? id;
}

/**
 * Every time zone the browser has, by standard name, with its offset at
 * `moment`: sorted by offset, and by name where offsets are equal. The
 * `extra` zones are listed too when the browser's list leaves them out (it
 * leaves out "UTC", which a browser can report as its own zone).
 */
export function timeZoneOptions(moment: Date, extra: readonly string[] = []): TimeZoneOption[] {
  const names = new Set<string>();
  for (const name of [...Intl.supportedValuesOf('timeZone'), ...extra]) {
    const id = canonicalTimeZone(name);
    if (id) {
      names.add(id);
    }
  }
  return [...names]
    .map((id) => timeZoneOption(id, moment))
    .filter((option) => option !== null)
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.id.localeCompare(b.id, 'en'));
}

/**
 * The zones whose name contains the query, ignoring case, or whose offset
 * does; a typed hyphen also finds the minus sign of the offsets shown.
 */
export function searchTimeZones(
  options: readonly TimeZoneOption[],
  query: string,
): TimeZoneOption[] {
  const wanted = query.trim().toLowerCase().replaceAll('-', MINUS);
  if (!wanted) {
    return [...options];
  }
  return options.filter(
    (option) =>
      option.id.toLowerCase().includes(wanted) || option.offset.toLowerCase().includes(wanted),
  );
}

/**
 * The time zone of where the browser is, as it reports it, by standard
 * name. It is the default for a new family and what the family page
 * compares the family's time zone with. Tests replace it to place the
 * browser anywhere.
 */
@Injectable({ providedIn: 'root' })
export class BrowserTimeZone {
  /** Null when the browser reports no time zone, or one it does not know. */
  current(): string | null {
    let reported: string | undefined;
    try {
      reported = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
    return reported ? canonicalTimeZone(reported) : null;
  }
}
