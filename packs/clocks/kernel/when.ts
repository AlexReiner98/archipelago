// When an item happens, worked out from its type's when capability (a moment, a span's start, or a repeat's hours on
// each day it falls on), in a time zone. A copy of the `when` half of the time axis (packs/query/kernel/timeaxis.ts,
// spansOf) and of a repeat's day (packs/loader/kernel/capabilities.ts, occurs): pure helpers a service pack copies
// rather than imports (docs/kernel-packs.md, "Moving a service in the wave"). Keep them the same as those.

const DAY = 86_400_000;
/** The most days a window may cover when repeats are worked out. */
const MAX_DAYS = 366 * 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The time zone days are counted in when the workspace names none: Toronto's, as the time pack always has. */
export const DEFAULT_ZONE = 'America/Toronto';

/** A repeat, as a when capability names its fields (capabilities.ts, Repeat). */
export interface Repeat { from: string; to?: string; days?: string; starts?: string; until?: string; skip?: string; moved?: string; done?: string }
/** The when capability (capabilities.ts, When). */
export interface When { at?: string; start?: string; end?: string; repeat?: Repeat }

/** What an item is, as far as when it happens goes. */
export interface Timed { id: string; type: string; props: Record<string, unknown>; created_at: Date | string }

/** One clock for each zone: making one is slow, and every item placed in time asks it. */
const clocks = new Map<string, Intl.DateTimeFormat>();
const clock = (zone: string) => clocks.get(zone) ?? clocks.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })).get(zone)!;

/** Milliseconds from UTC at an instant in a time zone: -4 h in Toronto in summer. */
function offset(zone: string, at: number): number {
  const parts = Object.fromEntries(clock(zone).formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}

/** The instant a day begins in a zone. */
export function dayStart(day: string, zone: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  return guess - offset(zone, guess - offset(zone, guess));
}

/** A field's value as an instant: a date-time as it is, a date as the start of its day. */
const instant = (value: unknown, zone: string): number | undefined =>
  typeof value !== 'string' ? undefined : DATE.test(value) ? dayStart(value, zone) : Number.isNaN(Date.parse(value)) ? undefined : Date.parse(value);

/** Hours since midnight from a time of day ("17:30" is 17.5); undefined for anything else. */
const clockHours = (t: unknown) => {
  const m = typeof t === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(t.trim()) : null;
  const n = m ? Number(m[1]) + Number(m[2]) / 60 : NaN;
  return n >= 0 && n <= 24 ? n : undefined;
};

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** A day of the week as 1 (Monday) to 7: a number, or a name or its first three letters ("mon"). */
const dayNumber = (d: unknown) => (typeof d === 'string' && d.trim().length >= 3 && !/^\d+$/.test(d.trim()) ? DAY_NAMES.findIndex((n) => n.startsWith(d.trim().toLowerCase())) + 1 : Number(d));

/** The hours a repeating thing holds on a day, if it falls on it: not before it starts or after it ends, not on a day skipped or done. */
export function occurs(repeat: Repeat, p: Record<string, unknown>, day: string, made?: string): [number, number] | undefined {
  const list = (key: string | undefined) => (key && Array.isArray(p[key]) ? (p[key] as unknown[]) : undefined);
  const days = list(repeat.days)?.length ? list(repeat.days)!.map(dayNumber) : [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(new Date(`${day}T12:00:00Z`).getUTCDay() || 7)) return undefined;
  const text = (key: string | undefined) => (key && typeof p[key] === 'string' ? (p[key] as string) : undefined);
  const starts = text(repeat.starts) ?? made;
  const until = text(repeat.until);
  if ((starts && day < starts) || (until && day > until)) return undefined;
  if (list(repeat.skip)?.includes(day) || list(repeat.done)?.includes(day)) return undefined;
  const all = repeat.moved ? p[repeat.moved] : undefined;
  const moved = all && typeof all === 'object' ? (all as Record<string, unknown>)[day] : undefined;
  const [a, b] = Array.isArray(moved) ? moved.map(clockHours) : [clockHours(p[repeat.from]), repeat.to === undefined ? clockHours(p[repeat.from]) : clockHours(p[repeat.to])];
  // A repeat with no end is a moment each day it falls on; one with an end holds from one hour to a later one.
  return a !== undefined && b !== undefined && (b > a || (repeat.to === undefined && b === a)) ? [a, b] : undefined;
}

/**
 * The instants an item's occurrences begin, of those that touch the window from the start of the day `from` (a date)
 * to the instant `to`, not included: as spansOf places an item by its when alone.
 */
export function startsOf(when: When, e: Timed, from: string, to: number, zone: string): number[] {
  const winFrom = dayStart(from, zone);
  const out: number[] = [];
  const add = (start: number, end: number) => {
    if (end >= winFrom && start < to) out.push(start);
  };
  if (when.repeat) {
    const made = new Date(e.created_at).toISOString().slice(0, 10);
    const days = Math.min(Math.ceil((to - winFrom) / DAY) + 1, MAX_DAYS);
    for (let i = 0; i < days; i++) {
      const day = new Date(winFrom + i * DAY + DAY / 2).toISOString().slice(0, 10);
      const hours = occurs(when.repeat, e.props, day, made);
      if (hours) add(dayStart(day, zone) + hours[0] * 3_600_000, dayStart(day, zone) + hours[1] * 3_600_000);
    }
    return out;
  }
  const wholeDay = (field: string | undefined) => (field !== undefined && typeof e.props[field] === 'string' && DATE.test(e.props[field] as string) ? DAY : 0);
  const start = instant(e.props[when.start ?? when.at ?? ''], zone) ?? instant(e.props[when.at ?? ''], zone);
  const end = instant(e.props[when.end ?? ''], zone);
  if (start !== undefined) add(start, end ?? start + wholeDay(when.start ?? when.at));
  return out;
}
