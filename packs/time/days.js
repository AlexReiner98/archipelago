// Days, hours and money as the time pack counts them. Days are counted in the workspace's time zone, which the
// kernel hands every call (ctx.zone); nothing here reads the clock: the moment is the call's (ctx.now).

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86_400_000;

/** The day a moment falls on in a zone, as 2026-10-15. */
export const today = (zone, at) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);
/** The Monday of the week a day is in. */
export const mondayOf = (day) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
export const cents = (n) => Math.round(n * 100) / 100;
export const longDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const shortDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const money = (n, currency) => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(n);

/** The hours of a block from its start to its end, when both are given and the end comes after the start. */
export function blockHours(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string') return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return ms > 0 ? cents(ms / 3_600_000) : undefined;
}

/** Milliseconds from UTC at an instant in a zone: -4 h in Toronto in summer. */
function offset(zone, at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(at / 1000) * 1000;
}

/** The instant a day begins in a zone. */
export function dayStart(day, zone) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  return guess - offset(zone, guess - offset(zone, guess));
}
