// Automations as rows of marks, decided without the map: the automations, where each falls next and how each last
// fired in, one row each out. The kernel draws a row's state, its name, then its marks (ui/screens.js); what each mark
// says is here. Next run is worked out by the kernel's clock from the automation's when, never stored.

const DAY = 86_400_000;
/** How far ahead next run is looked for: a weekly repeat falls within it. */
export const AHEAD_DAYS = 8;

/** The day an instant falls on in a zone, as a date. */
export const dayIn = (at, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The window next run is looked for in: from today to AHEAD_DAYS on, as days in the zone. */
export const windowFrom = (now, zone) => ({ from: dayIn(now, zone), to: dayIn(now + AHEAD_DAYS * DAY, zone) });

/** An instant as a person reads a next run: its weekday and hour in the zone, "Thu 08:00". */
export const shortWhen = (at, zone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.hour}:${parts.minute}`;
};

/** The whole of an instant, for a tooltip, in the zone. */
const longWhen = (at, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'full', timeStyle: 'short' }).format(at);

/** The first occurrence after now among an item's spans, as an instant; none when it has none ahead. */
export const nextOf = (spans, now) =>
  (spans ?? [])
    .map((s) => Date.parse(s.start))
    .filter((at) => at > now)
    .sort((a, b) => a - b)[0];

/**
 * How an automation last fired: the kept fact (automation.fired, newest first) when there is one, else the quick
 * props the old runner wrote (last_fired, last_result "ok: ..." or "failed: ..."). None when it never has.
 */
export function lastOf(item, fired) {
  const fact = (fired ?? [])[0];
  if (fact) {
    const d = fact.detail ?? {};
    return { at: d.at ?? fact.ts, ok: d.ok !== false, said: d.result ?? fact.reason ?? '' };
  }
  const p = item.props ?? {};
  if (typeof p.last_fired !== 'string') return undefined;
  const result = typeof p.last_result === 'string' ? p.last_result : '';
  return { at: p.last_fired, ok: !/^fail/i.test(result), said: result.replace(/^(ok|failed):\s*/i, '') };
}

/** What an automation does, as a mark: a glyph alone, so the name keeps the row's width; the word is in its tooltip. */
const doesMark = (action) => (action === 'launch' ? { text: '▶', tip: 'Launch: starts a session on a task' } : { text: '✉', tip: 'Notify: tells a person' });

/** One automation's row: its head, and its marks for next run, last firing and what it does. */
export function rowOf(item, { spans, fired, now, zone }) {
  const enabled = item.status === 'enabled';
  const next = enabled ? nextOf(spans, now) : undefined;
  const last = lastOf(item, fired);
  const marks = [
    next !== undefined ? { text: shortWhen(next, zone), tip: `Next: ${longWhen(next, zone)}` } : { text: '—', tip: enabled ? 'Nothing due in the next week' : 'Paused: does not run' },
    last ? { text: last.ok ? '✓' : '✗', ago: last.at, tone: last.ok ? 'ok' : 'bad', tip: `${last.ok ? 'Fired' : 'Failed'}${last.said ? `: ${last.said}` : ''}` } : { text: '·', tip: 'Never fired' },
    doesMark(item.props?.action ?? 'notify'),
  ];
  return { id: item.id, type: item.type, title: item.title, status: item.status, marks };
}

/** The rows, retired ones left out, enabled before paused, the soonest next run first. */
export function rowsOf(items, ctx) {
  const rows = items.filter((e) => e.status !== 'retired').map((e) => ({ e, next: e.status === 'enabled' ? nextOf(ctx.spans.get(e.id), ctx.now) : undefined }));
  rows.sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.e.title.localeCompare(b.e.title));
  return rows.map(({ e }) => rowOf(e, { spans: ctx.spans.get(e.id), fired: ctx.fired.get(e.id), now: ctx.now, zone: ctx.zone }));
}
