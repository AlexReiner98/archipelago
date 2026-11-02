// An investigation's record, read off the map: what was uncertain (its hypotheses), what was done (the experiments
// that test them, with the hours people logged, the hours agents' sessions spent and the commits that settle them)
// and what was learned (the results that support or refute them). Over one year, or all of it. The pack reads
// through ctx.read alone and writes nothing.

const isA = (item, type) => Boolean(item?.is?.includes(type));
const cents = (n) => Math.round(n * 100) / 100;
/** The first sentence of a note, at most a short line. */
const gist = (text) => {
  const point = String(text ?? '').trim().split(/(?<=[.:])\s|\n/)[0];
  return point.length > 140 ? `${point.slice(0, 139)}…` : point;
};

/** The year asked for as a window: its dates for fields, its instants for sessions. All of it when none is given. */
export function windowOf(year, now) {
  if (year !== undefined && !/^\d{4}$/.test(String(year))) throw new Error('year is a year, as 2026');
  if (!year) return { from: '2000-01-01', to: new Date(Date.parse(now) + 86_400_000).toISOString().slice(0, 10), within: () => true };
  const y = String(year);
  return { year: y, from: `${y}-01-01`, to: `${Number(y) + 1}-01-01`, within: (date) => typeof date === 'string' && date.startsWith(y) };
}

/** The hours a time entry stands for: from its start to its end when it was logged as a block, else its hours. */
const entryHours = (p) => {
  const block = (Date.parse(p.end) - Date.parse(p.start)) / 3_600_000;
  return Number.isFinite(block) && block > 0 ? block : Number(p.hours ?? 0);
};
/** The day a time entry falls on. */
const entryDate = (p) => p.date ?? (typeof p.start === 'string' ? p.start.slice(0, 10) : null);

/** Hours by who logged them, people's and agents', added up. */
const add = (into, hours) => {
  for (const [who, h] of Object.entries(hours.people)) into.people[who] = cents((into.people[who] ?? 0) + h);
  into.agents = cents(into.agents + hours.agents);
  return into;
};

export async function record(input, ctx) {
  const w = windowOf(input.year, ctx.now);
  const names = new Map();
  const nameOf = async (id) => {
    if (!id) return 'nobody';
    if (!names.has(id)) names.set(id, (await ctx.read({ get: id, fields: [] }))?.title ?? id);
    return names.get(id);
  };
  const investigations = input.of ? [await ctx.read({ get: input.of })].filter(Boolean) : await ctx.read({ items: { type: 'investigation' } });
  if (input.of && !isA(investigations[0], 'investigation')) throw new Error(`${input.of} is not an investigation`);
  // Where agents' sessions were at work in the window, and on what.
  const runs = await ctx.read({ placed: { types: ['run'], from: w.from, to: w.to, by: ['when'] } });
  const spans = runs.flatMap((r) => (r.time ?? []).filter((s) => s.on).map((s) => ({ on: s.on, hours: (Date.parse(s.end) - Date.parse(s.start)) / 3_600_000 })));

  /** The hours and commits of what is under some items: time entries part of them, sessions on them, commits settling them. */
  const effort = async (ids) => {
    const under = await ctx.read({ parts_of: ids });
    const within = new Set(under.map((e) => e.id));
    const hours = { people: {}, agents: 0 };
    for (const e of under.filter((x) => isA(x, 'time_entry') && ['logged', 'invoiced'].includes(x.status))) {
      if (!w.within(entryDate(e.props ?? {}))) continue;
      const who = await nameOf(e.owner);
      hours.people[who] = cents((hours.people[who] ?? 0) + entryHours(e.props ?? {}));
    }
    hours.agents = cents(spans.filter((s) => within.has(s.on)).reduce((sum, s) => sum + s.hours, 0));
    const commits = [];
    for (const id of ids)
      for (const c of await ctx.read({ related: id, relation: 'settles', direction: 'in', types: ['commit'], fields: ['sha'] }))
        if (w.within(String(c.created_at ?? '').slice(0, 10)) && !commits.some((x) => x.id === c.id)) commits.push({ id: c.id, title: c.title, sha: c.props?.sha ?? null });
    return { under, hours, commits };
  };

  const out = [];
  for (const inv of investigations) {
    const { under } = await effort([inv.id]);
    const hypotheses = under.filter((x) => isA(x, 'hypothesis'));
    const experiments = new Map(under.filter((x) => isA(x, 'experiment')).map((x) => [x.id, x]));
    const results = new Map(under.filter((x) => isA(x, 'result')).map((x) => [x.id, x]));
    const bears = new Map(); // result → what it supports and refutes
    for (const h of hypotheses) {
      for (const t of await ctx.read({ related: h.id, relation: 'tests', direction: 'in' })) if (!experiments.has(t.id)) experiments.set(t.id, t);
      for (const way of ['supports', 'refutes'])
        for (const r of await ctx.read({ related: h.id, relation: way, direction: 'in' })) {
          if (!results.has(r.id)) results.set(r.id, r);
          const b = bears.get(r.id) ?? { supports: [], refutes: [] };
          b[way].push(h.id);
          bears.set(r.id, b);
        }
    }
    const total = { people: {}, agents: 0 };
    const done = [];
    const counted = new Set();
    for (const x of experiments.values()) {
      const e = await effort([x.id]);
      for (const u of e.under) counted.add(u.id);
      add(total, e.hours);
      const tested = (await ctx.read({ related: x.id, relation: 'tests' })).map((h) => h.id);
      const busy = Object.keys(e.hours.people).length || e.hours.agents || e.commits.length;
      if (!busy && w.year && !w.within(String(x.created_at ?? '').slice(0, 10))) continue;
      done.push({ id: x.id, type: x.type, title: x.title, status: x.status, method: gist(x.props?.method), tests: tested, hours: e.hours, commits: e.commits });
    }
    // What was logged on the investigation or a hypothesis, outside any experiment, counts to the investigation as a whole.
    const rest = await effort([inv.id, ...hypotheses.map((h) => h.id)].filter((id) => !counted.has(id)));
    const loose = { people: {}, agents: 0 };
    for (const e of rest.under.filter((x) => isA(x, 'time_entry') && !counted.has(x.id) && ['logged', 'invoiced'].includes(x.status))) {
      if (!w.within(entryDate(e.props ?? {}))) continue;
      const who = await nameOf(e.owner);
      loose.people[who] = cents((loose.people[who] ?? 0) + entryHours(e.props ?? {}));
    }
    loose.agents = cents(spans.filter((s) => !counted.has(s.on) && rest.under.some((u) => u.id === s.on)).reduce((sum, s) => sum + s.hours, 0));
    add(total, loose);
    const learned = [...results.values()]
      .filter((r) => w.within(r.props?.measured_on ?? String(r.created_at ?? '').slice(0, 10)))
      .map((r) => ({ id: r.id, title: r.title, status: r.status, value: r.props?.value ?? null, measured_on: r.props?.measured_on ?? null, evidence: r.props?.evidence ?? null, ...(bears.get(r.id) ?? { supports: [], refutes: [] }) }));
    const uncertain = hypotheses
      .filter((h) => !w.year || String(h.created_at ?? '').slice(0, 10) < w.to)
      .map((h) => ({ id: h.id, title: h.title, status: h.status, prediction: gist(h.props?.prediction), said: gist(h.body) }));
    const commits = [...done.flatMap((d) => d.commits), ...rest.commits].filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);
    if (!input.of && w.year && !done.length && !learned.length && !Object.keys(total.people).length && !total.agents) continue;
    out.push({
      id: inv.id,
      title: inv.title,
      status: inv.status,
      baseline: gist(inv.props?.baseline),
      uncertain,
      done,
      learned,
      outside: loose,
      hours: { ...total, people_total: cents(Object.values(total.people).reduce((a, b) => a + b, 0)) },
      commits: commits.length,
      unlogged: done.filter((d) => !Object.keys(d.hours.people).length && !d.hours.agents).map((d) => d.id),
    });
  }
  return { ...(w.year && { year: w.year }), investigations: out };
}

/** Hours as a mark: "4.5 h". */
const h = (n) => `${cents(n)} h`;

/** Hours and commits as marks: "4.5 h · agents 2 h · 3 commits", what is nought left out. */
const marks = (hours, commits) => {
  const people = Object.values(hours.people).reduce((a, b) => a + b, 0);
  return [people && h(people), hours.agents && `agents ${h(hours.agents)}`, commits && `${commits} commit${commits === 1 ? '' : 's'}`].filter(Boolean);
};

/**
 * The record as rows, one line each: every investigation with its totals, then its hypotheses (what was uncertain),
 * experiments (what was done, with hours and commits) and results (what was learned). This year's unless a year or
 * one investigation (all of it) is asked for.
 */
export async function recordRows(input, ctx) {
  const year = input.year ?? (input.of ? undefined : String(ctx.now).slice(0, 4));
  const rows = [];
  for (const inv of (await record({ of: input.of, year }, ctx)).investigations) {
    const titleOf = new Map(inv.uncertain.map((x) => [x.id, x.title]));
    const bears = (r) => [...r.supports.map((id) => `supports ${titleOf.get(id) ?? id}`), ...r.refutes.map((id) => `refutes ${titleOf.get(id) ?? id}`)];
    rows.push(
      { id: inv.id, type: 'investigation', title: [inv.title, ...marks(inv.hours, inv.commits), inv.unlogged.length && `${inv.unlogged.length} unlogged`].filter(Boolean).join(' · '), status: inv.status },
      ...inv.uncertain.map((x) => ({ id: x.id, type: 'hypothesis', title: x.title, status: x.status })),
      ...inv.done.map((d) => ({ id: d.id, type: d.type, title: [d.title, ...marks(d.hours, d.commits.length)].join(' · '), status: d.status })),
      ...inv.learned.map((r) => ({ id: r.id, type: 'result', title: [r.value ?? r.title, ...bears(r)].join(' · '), status: r.status })),
    );
  }
  return rows;
}
