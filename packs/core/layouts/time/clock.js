// The time drawing's clock (index.js, day.js): days and hours are counted in the zone the answer's window was worked
// out in (the workspace's), so every reader sees the same calendar; with none said, in this browser's. Set by picture()
// before anything is laid out.

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Count in this zone from now on (none: this browser's). */
export const zoneIs = (z) => void (zone = z ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
const clocks = new Map();
/** The wall clock in the zone at an instant: year, month, day, hour, minute, second. */
const wall = (t) => {
  const f = clocks.get(zone) ?? clocks.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })).get(zone);
  const p = Object.fromEntries(f.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return [p.year, p.month, p.day, p.hour, p.minute, p.second];
};
/** Milliseconds the zone's clock is ahead of UTC at an instant. */
const offset = (t) => {
  const [y, mo, d, h, mi, s] = wall(t);
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(t / 1000) * 1000;
};
/** The instant a day begins in the zone, from its date (a day past the month's end runs on into the next). */
const startOf = (y, m, d) => {
  const guess = Date.UTC(y, m - 1, d);
  return guess - offset(guess - offset(guess));
};
/** The start of a day, from a date or a date-time. */
export const dayOf = (value) => {
  const date = /^(\d\d\d\d)-(\d\d)-(\d\d)$/.exec(value);
  const [y, m, d] = date ? date.slice(1).map(Number) : wall(new Date(value).getTime());
  return startOf(y, m, d);
};
/** The start of the day so many days after another: a day is not always 24 hours (the clocks change). */
export const dayAt = (day, n) => {
  const [y, m, d] = wall(day);
  return startOf(y, m, d + n);
};
export const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
export const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zone });
