// The week as a calendar: for each day, the owner's blocks (time entries, timed or not, and the days routines fall
// on) and the agents' lanes (the sessions the map recorded, each stretch with the work it was on), every block with
// the project it counts toward. Where a routine falls and when a session was at work is the kernel's time axis
// (a lens with time); the pack reads it rather than working it out again.

import { DAY, addDays, cents, dayStart, mondayOf, today } from './days.js';
import { isA, Reader } from './work.js';

/** Lay sessions in as few lanes as hold them without overlap, each keeping to one lane all day: one lane per agent at work at once. */
export function lanes(blocks) {
  const runs = new Map();
  for (const b of blocks) runs.set(b.id, [...(runs.get(b.id) ?? []), b]);
  const spans = [...runs.values()].map((bs) => ({ bs, from: Math.min(...bs.map((b) => b.from_hour)), to: Math.max(...bs.map((b) => b.to_hour)) })).sort((a, b) => a.from - b.from);
  const out = [];
  const ends = [];
  for (const s of spans) {
    let at = ends.findIndex((end) => end <= s.from);
    if (at < 0) (at = ends.length), out.push([]);
    ends[at] = Math.max(s.to, s.from + 0.05);
    out[at].push(...s.bs);
  }
  return out;
}

export async function week(input, ctx) {
  const zone = ctx.zone;
  const now = Date.parse(ctx.now);
  const day0 = today(zone, now);
  const asked = input.from ?? day0;
  if (!DAY.test(asked)) throw new Error('from must look like 2026-10-15');
  const from = mondayOf(asked);
  const to = addDays(from, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const edges = [...days, addDays(from, 7)].map((d) => dayStart(d, zone));
  const r = new Reader(ctx);
  const hourOf = (ms, d) => cents((ms - edges[d]) / 3_600_000);
  /** The parts of a span that fall on each day of the week. */
  const cut = function* (a, b) {
    for (let d = 0; d < 7; d++) {
      const x = Math.max(a, edges[d]);
      const y = Math.min(b, edges[d + 1]);
      if (y > x) yield { d, x, y };
    }
  };
  const iso = (t) => new Date(t).toISOString();
  const block = async (base, work) => ({ ...base, work: await r.title(work), work_id: work ?? null, project: await r.projectOf(work) });

  // The owner's lane: what they logged or planned, as blocks where they said when.
  const owner = days.map(() => []);
  for (const e of await r.entries({ status: ['logged', 'planned', 'invoiced'], from, to })) {
    const at = days.indexOf(e.date);
    const base = await block({ id: e.id, what: e.title, status: e.status }, e.work);
    const [s, en] = [e.start ? Date.parse(e.start) : NaN, e.end ? Date.parse(e.end) : NaN];
    if (!(en > s)) {
      if (at >= 0) owner[at].push({ ...base, start: null, end: null, from_hour: null, to_hour: null, hours: e.hours });
      continue;
    }
    // A block past midnight is drawn on each day it covers.
    for (const { d, x, y } of cut(s, en)) owner[d].push({ ...base, start: iso(x), end: iso(y), from_hour: hourOf(x, d), to_hour: hourOf(y, d), hours: cents((y - x) / 3_600_000) });
  }

  // Routines and sessions, placed by the kernel's time axis over the week and the two weeks before today.
  const back = addDays(day0, -13);
  const placed = await r.read({ view: 'lens', params: { kinds: ['time.routine', 'sys.run'], fold: [], time: { from: back < from ? back : from, to: day0 > to ? day0 : to, by: ['when'] } } });
  const routines = [];
  for (const item of placed.items.filter((i) => i.open && i.time?.some((s) => s.by === 'repeat'))) {
    const [part] = await r.read({ related: item.id, relation: 'part_of' });
    routines.push({ item, work: part?.id ?? null, link: part?.link ?? null });
  }
  /** A day a routine falls on, as a block. One for a piece of work is planned time for it; one for nothing holds the time. */
  const routineDay = async ({ item, work, link }, span) => {
    const date = today(zone, Date.parse(span.start));
    const base = dayStart(date, zone);
    const [a, b] = [Date.parse(span.start), Date.parse(span.end)];
    return block({ id: item.id, what: item.title, date, routine: true, link, start: span.start, end: span.end, from_hour: cents((a - base) / 3_600_000), to_hour: cents((b - base) / 3_600_000), hours: cents((b - a) / 3_600_000), status: 'routine' }, work);
  };
  for (const rt of routines)
    for (const span of rt.item.time) {
      const at = days.indexOf(today(zone, Date.parse(span.start)));
      if (at >= 0) owner[at].push(await routineDay(rt, span));
    }

  // The agents' lanes: each session's stretches at work in the week, with what it was on. Time on nothing in
  // particular counts to the place it ran in. A run reported only once it was over has no length: each day counts them.
  const agents = days.map(() => []);
  const reported = days.map(() => 0);
  // In the order they began, so that two begun at once always take the same lanes.
  const begun = (run) => Math.min(...(run.time ?? []).map((s) => Date.parse(s.start)));
  for (const run of placed.items.filter((i) => i.type === 'sys.run').sort((a, b) => begun(a) - begun(b) || a.id.localeCompare(b.id)))
    for (const span of run.time ?? []) {
      const [a, b] = [Date.parse(span.start), Date.parse(span.end)];
      if (b <= a) {
        const d = edges.findIndex((edge, i) => i < 7 && a >= edge && a < edges[i + 1]);
        if (d >= 0) reported[d]++;
        continue;
      }
      const on = span.on ? await r.get(span.on) : null;
      const what = (on && !isA(on, 'place') && on.title) || run.title;
      for (const { d, x, y } of cut(a, b))
        agents[d].push(await block({ id: run.id, what, start: iso(x), end: iso(y), from_hour: hourOf(x, d), to_hour: hourOf(y, d), hours: cents((y - x) / 3_600_000), status: run.status, session: run.title, open: run.open }, span.on ?? null));
    }

  // Planned time whose end has passed, whatever week it was in, and the days a routine for some work has passed in
  // the last two weeks: the owner says whether they happened.
  const due = [];
  for (const e of await r.entries({ status: 'planned', to: day0 })) {
    if (!(e.end ? Date.parse(e.end) <= now : e.date < day0)) continue;
    due.push(await block({ id: e.id, what: e.title, date: e.date, start: e.start, end: e.end, from_hour: null, to_hour: null, hours: e.hours, link: e.link, status: e.status }, e.work));
  }
  for (const rt of routines.filter((x) => x.work))
    for (const span of rt.item.time) {
      const date = today(zone, Date.parse(span.start));
      if (date >= back && date <= day0 && Date.parse(span.end) <= now) due.push(await routineDay(rt, span));
    }
  due.sort((a, b) => (a.start ?? a.date).localeCompare(b.start ?? b.date));

  const counted = new Set([...owner.flat(), ...agents.flat(), ...due].map((b) => b.project).filter(Boolean));
  return {
    from,
    to,
    zone,
    // Every project the week touches, in a fixed order, so each keeps one colour all week.
    projects: await Promise.all([...counted].sort().map(async (id) => ({ id, title: await r.title(id) }))),
    days: days.map((date, i) => ({
      date,
      hours: cents(owner[i].filter((b) => b.status !== 'planned' && !b.routine).reduce((n, b) => n + b.hours, 0)),
      // A routine for some work is time planned for it; one for nothing is not work at all.
      planned: cents(owner[i].filter((b) => b.status === 'planned' || (b.routine && b.work_id)).reduce((n, b) => n + b.hours, 0)),
      owner: owner[i],
      agents: lanes(agents[i]),
      reported: reported[i],
    })),
    to_confirm: due,
  };
}
