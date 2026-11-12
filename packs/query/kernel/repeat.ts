// When a repeating thing falls (the capability when's repeat, as the loader declares it): the hours it holds on a day.
// A small pure helper copied from the loader's capabilities (occurs), as a pack copies one rather than import the
// kernel: the time axis works a repeat out into its occurrences with it.

/** A repeat, as a type's `when` names its fields. */
export interface Repeat {
  from: string;
  /** When it ends on each day; without it, each occurrence is a moment (a reminder at 08:00). */
  to?: string;
  days?: string;
  starts?: string;
  until?: string;
  skip?: string;
  moved?: string;
  /** Days that happened and were recorded on their own: no longer drawn from the repeat. */
  done?: string;
}

const clockHours = (t: unknown) => {
  const m = typeof t === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(t.trim()) : null;
  const n = m ? Number(m[1]) + Number(m[2]) / 60 : NaN;
  return n >= 0 && n <= 24 ? n : undefined;
};

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
/** A day of the week as 1 (Monday) to 7: a number, or a name or its first three letters ("mon"). */
const dayNumber = (d: unknown) => (typeof d === 'string' && d.trim().length >= 3 && !/^\d+$/.test(d.trim()) ? DAY_NAMES.findIndex((n) => n.startsWith(d.trim().toLowerCase())) + 1 : Number(d));

/**
 * The hours a repeating thing holds on a day, if it falls on it: not before it starts or after it ends, not on a
 * day skipped or done. `made` is the day it was made, the start when it names none.
 */
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
