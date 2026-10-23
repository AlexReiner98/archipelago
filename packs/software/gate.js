// The gate: an event (a release, a launch) as the checklist it has to clear. What it waits for (what it depends
// on), by stream; what it was planned to go ahead without (what it defers); what nobody has yet put on either side
// (open work under what it ships); and how we know (the proof questions of what it ships and of what holds it). A
// stream is not stored: it is the feature or project a held item is part of, or the held item itself when that is a
// feature or project, which then brings all its work. Without an event, the open events there are. A kernel view
// until 23 Oct 2026; a release's checklist is this pack's idea, beside its proof.

import { proof } from './proof.js';
import { isA } from './repo.js';

/** What holds work together: what the roadmap starts from or is made of (its tree in pack.json). */
const CONTAINERS = ['work.project', 'software.feature'];
const container = (e) => CONTAINERS.some((t) => isA(e, t));
const slim = (e) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
/** A feature that is built is ready for a release, though it stays open until it ships. */
const done = (e) => !e.is_open || e.status === 'built';

export async function gate(input, ctx) {
  const linked = (id, relation) => ctx.read({ related: id, relation, fields: [] });
  if (!input.event) {
    const events = [];
    for (const e of (await ctx.read({ items: { type: 'event' }, fields: ['at'] })).filter((x) => x.is_open)) {
      const [held, deferred, shipped] = await Promise.all([linked(e.id, 'depends_on'), linked(e.id, 'defers'), linked(e.id, 'ships')]);
      if (held.length || deferred.length || shipped.length) events.push({ ...slim(e), at: e.props.at ?? null, holding: held.length });
    }
    return { events };
  }
  const event = await ctx.read({ get: input.event });
  if (!event) throw new Error(`No item "${input.event}"`);
  if (!isA(event, 'event')) throw new Error(`gate needs an event (a release, a launch, a deadline); "${event.title}" is a ${event.type}`);

  // What is sorted and counted behind a gate: things that get done or settled: work that can be estimated, and questions that settle.
  const types = new Map();
  const typeOf = async (type) => (types.has(type) ? types.get(type) : (types.set(type, await ctx.read({ type_info: type })), types.get(type)));
  const counted = async (e) => {
    const t = await typeOf(e.type);
    return Boolean((t?.estimated && isA(e, 'work')) || t?.settles);
  };
  // Everything part of an item, at any depth, by its id; the item itself left out.
  const underOf = new Map();
  const under = async (id) => {
    if (!underOf.has(id)) underOf.set(id, new Map((await ctx.read({ scope: id, parts: true, fields: [] })).filter((e) => e.id !== id).map((e) => [e.id, e])));
    return underOf.get(id);
  };
  // The nearest feature or project an item is part of.
  const upOf = new Map();
  const up = async (id) => (upOf.has(id) ? upOf.get(id) : (upOf.set(id, await linked(id, 'part_of')), upOf.get(id)));
  const nearest = async (id) => {
    const seen = new Set([id]);
    let level = [id];
    while (level.length) {
      const above = [];
      for (const x of level) for (const e of await up(x)) if (!seen.has(e.id)) (seen.add(e.id), above.push(e));
      const found = above.find(container);
      if (found) return found;
      level = above.map((e) => e.id);
    }
    return undefined;
  };

  const me = await ctx.read({ me: true });
  const items = new Map();
  const itemOf = async (id) => (items.has(id) ? items.get(id) : (items.set(id, await ctx.read({ get: id, fields: [] })), items.get(id)));
  // The owner's to answer, act on or decide: they are it, or it is theirs to settle by their word and still open.
  const mine = async (id) => {
    if (id === me) return true;
    const e = await itemOf(id);
    return Boolean(e && e.owner === me && e.is_open && (await typeOf(e.type))?.settled_by === 'word');
  };
  const held = await linked(event.id, 'depends_on');
  const deferred = await linked(event.id, 'defers');
  const shipped = await linked(event.id, 'ships');

  // The streams: a feature or project that holds the event brings its work with it.
  const streams = new Map();
  const placed = new Set();
  const entries = [];
  for (const head of held.filter(container)) {
    const work = [];
    for (const e of (await under(head.id)).values()) if (!container(e) && !placed.has(e.id) && (await counted(e))) work.push(e);
    for (const w of work) placed.add(w.id);
    placed.add(head.id);
    const list = work.length ? work.map((w) => ({ e: w })) : [{ e: head }];
    streams.set(head.id, { head, relation: head.link, list });
    entries.push(...list);
  }
  for (const e of held) {
    if (placed.has(e.id)) continue;
    placed.add(e.id);
    const head = await nearest(e.id);
    const stream = streams.get(head?.id ?? '') ?? { head, list: [] };
    const entry = { e, relation: e.link };
    stream.list.push(entry);
    entries.push(entry);
    streams.set(head?.id ?? '', stream);
  }
  const open = entries.filter(({ e }) => !done(e)).map(({ e }) => e.id);
  const blocks = open.length ? await ctx.read({ blocked: open }) : {};
  const item = async ({ e, relation }) => {
    const roots = done(e) ? [] : (blocks[e.id]?.roots ?? []);
    let yours = false;
    if (!done(e) && me) for (const id of [e.id, ...roots.map((r) => r.id)]) if (await mine(id)) yours = true;
    return {
      ...slim(e),
      done: done(e),
      blocked: !done(e) && Boolean(blocks[e.id]?.blocked),
      /** The owner has to answer, act or decide before this can move. */
      yours,
      waiting_on: roots.filter((r) => r.title !== undefined).map(slim),
      /** The link that makes it hold the event, when it does so itself and not through its stream. */
      relation,
    };
  };

  const left = new Set(deferred.map((e) => e.id));
  for (const e of deferred) for (const id of (await under(e.id)).keys()) left.add(id);
  const scope = new Map(shipped.map((e) => [e.id, e]));
  for (const e of shipped) for (const [id, x] of await under(e.id)) scope.set(id, x);
  const toSort = [];
  for (const e of scope.values()) {
    if (e.id === event.id || !e.is_open || container(e) || placed.has(e.id) || left.has(e.id) || !(await counted(e))) continue;
    const s = await nearest(e.id);
    toSort.push({ ...slim(e), stream: s ? { id: s.id, title: s.title } : null });
  }

  // What a user would ask of what this ships and of what holds it. Answered on the release's own build, or not
  // answered: a release that names its version is not helped by what passed on an earlier one.
  const asked = new Set();
  for (const e of [...shipped, ...held.filter(container)]) {
    asked.add(e.id);
    for (const id of (await under(e.id)).keys()) asked.add(id);
  }
  const version = typeof event.props.version === 'string' && event.props.version.trim() ? event.props.version.trim() : undefined;
  const proven = asked.size ? await proof({ build: version, within: [...asked] }, ctx).catch(() => undefined) : undefined;
  const known = proven?.proofs?.length && proven.counts ? { build: proven.build ?? null, counts: proven.counts, proofs: proven.proofs } : undefined;

  const rank = (i) => (i.done ? 2 : i.yours ? 0 : 1);
  const out = [];
  for (const s of streams.values()) {
    const list = [];
    for (const entry of s.list) list.push(await item(entry));
    out.push({
      ...(s.head ? slim(s.head) : { id: null, type: null, title: null, status: null }),
      relation: s.relation,
      progress: { done: list.filter((i) => i.done).length, total: list.length },
      yours: list.filter((i) => i.yours).length,
      items: list.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)),
    });
  }
  const left_open = (s) => s.progress.total - s.progress.done;
  out.sort((a, b) => Number(left_open(a) === 0) - Number(left_open(b) === 0) || b.yours - a.yours || left_open(b) - left_open(a) || (a.title ?? '').localeCompare(b.title ?? ''));
  const all = out.flatMap((s) => s.items);
  return {
    event: { ...slim(event), open: event.is_open, at: event.props.at ?? null },
    counts: { holding: all.length, open: all.filter((i) => !i.done).length, yours: all.filter((i) => i.yours).length, to_sort: toSort.length, can_follow: deferred.length },
    /** Nothing it waits for is still open, and nothing is left to sort. */
    clear: all.every((i) => i.done) && toSort.length === 0 && (!known || known.counts.answered === known.counts.questions),
    /** How we know: the proof questions of what it ships and of what holds it, on the release's build (its version) or, when it names none, the build last reported. */
    proof: known ? { build: known.build, named: Boolean(version), counts: known.counts, questions: known.proofs.map(({ tests: _tests, ...q }) => q) } : null,
    to_sort: toSort.sort((a, b) => (a.stream?.title ?? '').localeCompare(b.stream?.title ?? '') || a.title.localeCompare(b.title)),
    streams: out,
    can_follow: deferred.map((e) => ({ ...slim(e), open: e.is_open, relation: e.link })),
    how: 'To sort an item: link the event to it with depends_on (the event waits for it) or defers (it can follow). To move one across, unlink the link given here and link the other.',
  };
}
