// Views: the questions the map exists to answer. Nothing here is stored;
// blockers are derived from relations every time, so they cannot go stale.

import { pastBounds } from './bounds.ts';
import { blockGraph } from './blocking.ts';
import { attention, type Input } from './attention.ts';
import { ACTIVE_HOLDS, type Entity, type Archipelago, type Op } from './pelago.ts';
import { spent } from './spent.ts';
import { hubs, HUB_AT, lens } from './lens.ts';
import { findPlace, scopeOf } from './places.ts';
import { brief } from './brief.ts';
import { savedViews } from './saved-views.ts'; import { pageStyle } from './styles.ts';

/**
 * How a kernel view asks a question a pack answers (the gate asks proof of the software pack). Handed in by
 * src/askview.ts, which needs these views itself; without a pack that answers, there is no answer.
 */
type PackAsker = (l: Archipelago, name: string, params: Record<string, unknown>) => Promise<unknown>;
let askPack: PackAsker | undefined;
export const setPackAsker = (asker: PackAsker) => void (askPack = asker); export const askPackView: PackAsker = (l, name, params) => (askPack ? askPack(l, name, params) : Promise.reject(new Error(`No view "${name}"`)));

async function person(l: Archipelago, given?: string): Promise<string> {
  const id = given ?? (l.viewer || (await l.setting<string>('me')));
  if (!id) throw new Error('No person given and no workspace owner set. Run: pelago init "Your Name"');
  return id;
}

async function changedSince(l: Archipelago, input: { since?: string; limit?: number }) {
  if (!input.since || Number.isNaN(Date.parse(input.since))) throw new Error('changed_since needs "since" as an ISO date or date-time');
  // The counts are of everything since; the events are the newest of them, few enough to read.
  const events = await l.events({ since: input.since, limit: input.limit ?? 50 });
  const { rows } = await l.db.query<{ action: string; n: number }>(`select action, count(*)::int as n from event where ts >= $1::timestamptz group by action order by n desc`, [input.since]);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return {
    since: input.since,
    counts: Object.fromEntries(rows.map((r) => [r.action, r.n])),
    events,
    ...(total > events.length && { more: `The newest ${events.length} of ${total} events. Ask with a higher limit (500 at most) or a later since for the rest.` }),
  };
}

/** The longest a handoff note may grow to from an agent: one of each part, rewritten, not a part added by every session. */
export const HANDOFF_MAX = 3000;

/** Minutes without a report before an open session is shown as stale. */
const STALE_MINUTES = 30;

async function sessions(l: Archipelago) {
  const runs = l.registry.family('sys.run');
  const { rows: open } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null order by created_at desc`, [runs]);
  const { rows: links } = await l.db.query<{ run: string; type: string; id: string; title: string; entity_type: string }>(
    `select r.from_id as run, r.type, e.id, e.title, e.type as entity_type from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.valid_to is null and r.type in ('sys.works_on', 'holds', 'software.lives_in')`,
    [open.map((r) => r.id)],
  );
  const { rows: ended } = await l.db.query(
    `select id, title, status, updated_at from entity where type = any($1::text[]) and not is_open and archived_at is null order by updated_at desc limit 10`,
    [runs],
  );
  const of = (run: string, type: string) => links.filter((x) => x.run === run && x.type === type).map(({ id, title, entity_type }) => ({ id, title, type: entity_type }));
  return {
    stale_after_minutes: STALE_MINUTES,
    open: open.map((r) => {
      const seen = (r.props.last_seen as string | undefined) ?? r.created_at.toISOString();
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        surface: r.props.surface,
        cwd: r.props.cwd,
        started: r.created_at,
        last_seen: seen,
        stale: Date.now() - Date.parse(seen) > STALE_MINUTES * 60_000,
        working_on: of(r.id, 'sys.works_on'),
        holds: of(r.id, 'holds'),
        repo: of(r.id, 'software.lives_in')[0],
      };
    }),
    recently_ended: ended,
  };
}

/** Which relations each preset draws: these roots, and every relation extending them. */
const GRAPH_PRESETS: Record<string, string[] | undefined> = {
  blocking: ['depends_on', 'waits_on', 'needs', 'holds'],
  structure: ['part_of', 'serves', 'lives_in', 'works_at'],
  all: undefined,
};
const GRAPH_LIMIT = 400;

/** Nodes and edges for drawing: the whole map under a preset, or the neighbourhood of one entity. */
async function graph(l: Archipelago, input: { focus?: string; depth?: number; relations?: string; include_closed?: boolean; include_system?: boolean }) {
  const preset = input.relations ?? (input.focus ? 'all' : 'blocking');
  if (!(preset in GRAPH_PRESETS)) throw new Error(`relations must be one of: ${Object.keys(GRAPH_PRESETS).join(', ')}`);
  const only = GRAPH_PRESETS[preset] && l.registry.relationFamily(...GRAPH_PRESETS[preset]);
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, props, created_at from entity where archived_at is null`);
  const system = (type: string) => l.registry.type(type)?.system ?? false;
  const eligible = new Map(
    entities.filter((e) => e.id === input.focus || ((input.include_closed || e.is_open) && (input.include_system || !system(e.type)))).map((e) => [e.id, e]),
  );
  if (input.focus && !eligible.has(input.focus)) throw new Error(`No entity "${input.focus}"`);
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(
    `select id, type, from_id, to_id from relation where valid_to is null and ($1::text[] is null or type = any($1::text[]))`,
    [only ?? null],
  );
  let edges = relations.filter((r) => eligible.has(r.from_id) && eligible.has(r.to_id));

  let keep: Set<string>;
  if (input.focus) {
    // Walk outwards from the focus, ignoring direction.
    const depth = Math.min(Math.max(input.depth ?? 2, 1), 4);
    keep = new Set([input.focus]);
    let frontier = [input.focus];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = [];
      for (const e of edges) {
        for (const [a, b] of [[e.from_id, e.to_id], [e.to_id, e.from_id]]) {
          if (frontier.includes(a) && !keep.has(b)) {
            keep.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
  } else {
    // Without a focus, an entity nothing connects to adds nothing to a graph.
    keep = new Set(edges.flatMap((e) => [e.from_id, e.to_id]));
  }
  const total = keep.size;
  if (keep.size > GRAPH_LIMIT) keep = new Set([...keep].slice(0, GRAPH_LIMIT));
  edges = edges.filter((e) => keep.has(e.from_id) && keep.has(e.to_id));

  // Tokens: what each thing is expected to take and has taken, with everything that is part of it, in sight or not.
  // A thing with parts is expected to take the sum of what they are; its own estimate stands only while none of its
  // parts has one. Where some parts have an estimate and some have not, the sum is short, and says so (`partial`).
  const all = new Map(entities.map((e) => [e.id, e]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null`);
  const partsOf = new Map<string, string[]>();
  for (const p of parts) if (all.has(p.from_id)) partsOf.set(p.to_id, [...(partsOf.get(p.to_id) ?? []), p.from_id]);
  // What is work, and so has a place on a scale of tokens: what can be estimated, and what such things are part of.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || l.registry.isA(type, 'work');
  type Tokens = { estimated: number; used: number; assumed?: boolean; partial?: boolean };
  const totals = new Map<string, Tokens>();
  // A feature that is built is done, though it stays open until it ships.
  const done = (e: Entity | undefined) => Boolean(e) && (!e!.is_open || e!.status === 'built');
  const tokens = (id: string, trail = new Set<string>()): Tokens => {
    const known = totals.get(id);
    if (known) return known;
    if (trail.has(id)) return { estimated: 0, used: 0 }; // a loop of belonging: stop going round
    trail.add(id);
    // Only work has tokens. And a part that is also part of another part (a task of a feature, linked to the project too) is counted there, once.
    const mine = (partsOf.get(id) ?? []).filter((part) => work(all.get(part)!.type));
    const nearer = new Set(mine.flatMap((part) => partsOf.get(part) ?? []));
    const inside = mine.filter((part) => !nearer.has(part)).map((part) => tokens(part, trail));
    trail.delete(id);
    const own = all.get(id)?.props ?? {};
    const ofParts = inside.reduce((n, t) => n + t.estimated, 0);
    const sum: Tokens = { estimated: ofParts || Number(own.tokens_estimated ?? 0), used: Number(own.tokens_used ?? 0) + inside.reduce((n, t) => n + t.used, 0) };
    if (ofParts && inside.some((t) => !t.estimated || t.partial)) sum.partial = true;
    // What is finished has been paid for. Where nothing measured it, it is taken to have used what it was expected to.
    if (done(all.get(id)) && !sum.used && sum.estimated) Object.assign(sum, { used: sum.estimated, assumed: true });
    else if (inside.some((t) => t.assumed)) sum.assumed = true;
    totals.set(id, sum);
    return sum;
  };

  const blocked = await blockGraph(l);
  return {
    preset,
    focus: input.focus,
    truncated: total > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: total } : undefined,
    nodes: [...keep].map((id) => {
      const e = eligible.get(id)!;
      return {
        id,
        type: e.type,
        ...l.registry.ancestry(e.type),
        title: e.title,
        status: e.status,
        open: e.is_open,
        created: e.created_at,
        blocked: blocked.isBlocked(id),
        ...(work(e.type) && { work: true, tokens: tokens(id), estimated: e.props.tokens_estimated != null, order: e.props.order as number | undefined }),
      };
    }),
    edges: edges.map((e) => ({ id: e.id, type: e.type, from: e.from_id, to: e.to_id })),
  };
}

/**
 * A tree a pack declares over "is part of", from one root: its branches in
 * order, the work under each, progress rolled up from that work, and where
 * work is happening now. Without a root, the roots there are to choose from.
 */
async function tree(l: Archipelago, input: { tree?: string; root?: string }) {
  const defs = l.registry.trees;
  const def = input.tree ? defs.get(input.tree) : defs.size === 1 ? [...defs.values()][0] : undefined;
  if (!def) throw new Error(`tree must be one of: ${[...defs.keys()].join(', ')}`);
  const isA = (type: string, kinds: string[]) => kinds.some((kind) => l.registry.isA(type, kind));
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, props, created_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null`);
  const kids = new Map<string, Entity[]>();
  for (const link of links) {
    const child = byId.get(link.from_id);
    if (child && byId.has(link.to_id)) kids.set(link.to_id, [...(kids.get(link.to_id) ?? []), child]);
  }
  const about = { id: def.id, title: def.title };
  if (!input.root) {
    const roots = entities
      .filter((e) => isA(e.type, def.roots))
      .map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, branches: (kids.get(e.id) ?? []).filter((k) => isA(k.type, def.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const root = byId.get(input.root);
  if (!root) throw new Error(`No entity "${input.root}"`);

  const { rows: sessions } = await l.db.query<{ target: string; id: string; title: string }>(
    `select r.to_id as target, s.id, s.title from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null`,
  );
  const blocked = await blockGraph(l);
  const item = (e: Entity) => {
    const on = sessions.filter((s) => s.target === e.id).map(({ id, title }) => ({ id, title }));
    return { id: e.id, type: e.type, title: e.title, status: e.status, open: e.is_open, blocked: blocked.isBlocked(e.id), sessions: on, active: on.length > 0 || def.active.includes(e.status) };
  };
  type Item = ReturnType<typeof item>;
  interface Branch extends Item {
    order: number | null;
    progress: { done: number; total: number };
    branches: Branch[];
    work: Item[];
  }
  const now: (Item & { path: string[] })[] = [];
  const place = (e: Entity) => (typeof e.props[def.order] === 'number' ? (e.props[def.order] as number) : null);
  const seen = new Set([root.id]);
  const build = (e: Entity, path: string[]): Branch => {
    // Each thing appears once. Branches are walked before work is counted, so
    // work that is part of both a branch and something above it sits under the branch.
    const claim = (wanted: (k: Entity) => boolean) => {
      const taken = (kids.get(e.id) ?? []).filter((k) => !seen.has(k.id) && wanted(k));
      for (const k of taken) seen.add(k.id);
      return taken;
    };
    const self = item(e);
    if (self.active && e !== root) now.push({ ...self, path });
    const here = e === root ? [] : [...path, e.title];
    // Placed branches first, in order; the rest after them, oldest first.
    const branches = claim((k) => isA(k.type, def.branches))
      .sort((a, b) => (place(a) ?? Infinity) - (place(b) ?? Infinity) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((k) => build(k, here));
    const work = claim((k) => isA(k.type, def.work)).map(item);
    now.push(...work.filter((w) => w.active).map((w) => ({ ...w, path: here })));
    const progress = branches.reduce((sum, b) => ({ done: sum.done + b.progress.done, total: sum.total + b.progress.total }), { done: work.filter((w) => !w.open).length, total: work.length });
    return { ...self, active: self.active || work.some((w) => w.active) || branches.some((b) => b.active), order: place(e), progress, branches, work };
  };
  const top = build(root, []);
  const { rows: depends } = await l.db.query<{ from: string; to: string }>(`select from_id as "from", to_id as "to" from relation where type = 'depends_on' and valid_to is null`);
  const flat = (b: Branch): Branch[] => [b, ...b.branches.flatMap(flat)];
  const by_status: Record<string, number> = {};
  for (const b of top.branches.flatMap(flat)) by_status[b.status] = (by_status[b.status] ?? 0) + 1;
  return {
    tree: about,
    root: { id: top.id, type: top.type, title: top.title, status: top.status },
    progress: top.progress,
    by_status,
    now,
    branches: top.branches,
    /** Work that belongs to the root but to no branch of it. */
    unplaced: top.work,
    /** What waits on what, within this tree: "from" cannot finish until "to" has. */
    depends: depends.filter((d) => seen.has(d.from) && seen.has(d.to)),
  };
}

/** What is sorted and counted behind a gate: things that get done or settled: work that can be estimated, and questions that settle. */
const gateWork = (l: Archipelago, type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated && l.registry.isA(type, 'work')) || Boolean(l.registry.type(type)?.capabilities.settles);

/**
 * An event as a gate: the work it waits for (what it depends on), by stream;
 * what it was planned to go ahead without (what it defers); and what nobody
 * has yet put on either side (open work under what it ships). A stream is not
 * stored: it is the feature or project a held item is part of, or the held
 * item itself when that is a feature or project, which then brings all its
 * work. Without an event, the open events there are.
 */
async function gate(l: Archipelago, input: { event?: string }) {
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, owner, props, created_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(
    `select id, type, from_id, to_id from relation where valid_to is null and type = any($1::text[])`,
    [['part_of', 'depends_on', 'defers', 'software.ships']],
  );
  const live = links.filter((r) => byId.has(r.from_id) && byId.has(r.to_id));
  const from = (type: string, id: string) => live.filter((r) => r.type === type && r.from_id === id);
  if (!input.event) {
    const events = entities.filter((e) => l.registry.isA(e.type, 'event') && e.is_open && (from('depends_on', e.id).length || from('defers', e.id).length || from('software.ships', e.id).length));
    return { events: events.map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, at: (e.props.at as string | undefined) ?? null, holding: from('depends_on', e.id).length })) };
  }
  const event = byId.get(input.event);
  if (!event) throw new Error(`No entity "${input.event}"`);
  if (!l.registry.isA(event.type, 'event')) throw new Error(`gate needs an event (a release, a launch, a deadline); "${event.title}" is a ${event.type}`);

  const kids = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const r of live.filter((x) => x.type === 'part_of')) {
    kids.set(r.to_id, [...(kids.get(r.to_id) ?? []), r.from_id]);
    parents.set(r.from_id, [...(parents.get(r.from_id) ?? []), r.to_id]);
  }
  const isA = (e: Entity, kinds: string[]) => kinds.some((kind) => l.registry.isA(e.type, kind));
  // What holds work together: whatever a pack's tree starts from or is made of (a project, a feature).
  const containers = [...l.registry.trees.values()].flatMap((t) => [...t.roots, ...t.branches]);
  const under = (id: string) => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      for (const kid of kids.get(stack.pop()!) ?? []) {
        if (seen.has(kid)) continue;
        seen.add(kid);
        stack.push(kid);
      }
    }
    return seen;
  };
  /** The nearest feature or project an item is part of. */
  const nearest = (id: string) => {
    const seen = new Set([id]);
    let level = [id];
    while (level.length) {
      const up = level.flatMap((x) => parents.get(x) ?? []).filter((x) => !seen.has(x));
      const found = up.find((x) => isA(byId.get(x)!, containers));
      if (found) return byId.get(found)!;
      for (const x of up) seen.add(x);
      level = up;
    }
    return undefined;
  };

  const graph = await blockGraph(l);
  const me = await person(l).catch(() => undefined);
  const mine = (id: string) => id === me || (byId.get(id)?.owner === me && l.registry.type(byId.get(id)!.type)?.capabilities.settles?.by === 'word' && byId.get(id)!.is_open);
  // A feature that is built is ready for a release, though it stays open until it ships.
  const done = (e: Entity) => !e.is_open || e.status === 'built';
  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  const item = (e: Entity, relation?: string) => {
    const roots = done(e) ? [] : graph.roots(e.id);
    return {
      ...slim(e),
      done: done(e),
      blocked: !done(e) && graph.isBlocked(e.id),
      /** The owner has to answer, act or decide before this can move. */
      yours: !done(e) && Boolean(me) && (mine(e.id) || roots.some(mine)),
      waiting_on: roots.map((id) => byId.get(id)).filter((r) => r !== undefined).map(slim),
      /** The link that makes it hold the event, when it does so itself and not through its stream. */
      relation,
    };
  };
  type Item = ReturnType<typeof item>;

  const held = from('depends_on', event.id);
  const streams = new Map<string, { head: Entity | undefined; relation?: string; items: Item[] }>();
  const placed = new Set<string>();
  // A feature or project that holds the event brings its work with it.
  for (const r of held) {
    const head = byId.get(r.to_id)!;
    if (!isA(head, containers)) continue;
    const work = [...under(head.id)].map((id) => byId.get(id)!).filter((e) => gateWork(l, e.type) && !isA(e, containers) && !placed.has(e.id));
    for (const w of work) placed.add(w.id);
    placed.add(head.id);
    streams.set(head.id, { head, relation: r.id, items: work.length ? work.map((w) => item(w)) : [item(head)] });
  }
  for (const r of held) {
    const e = byId.get(r.to_id)!;
    if (placed.has(e.id)) continue;
    placed.add(e.id);
    const head = nearest(e.id);
    const stream = streams.get(head?.id ?? '') ?? { head, items: [] };
    stream.items.push(item(e, r.id));
    streams.set(head?.id ?? '', stream);
  }

  const deferred = from('defers', event.id);
  const left = new Set(deferred.flatMap((r) => [r.to_id, ...under(r.to_id)]));
  const scope = new Set(from('software.ships', event.id).flatMap((r) => [r.to_id, ...under(r.to_id)]));
  const toSort = [...scope]
    .map((id) => byId.get(id)!)
    .filter((e) => e.id !== event.id && e.is_open && gateWork(l, e.type) && !isA(e, containers) && !placed.has(e.id) && !left.has(e.id))
    .map((e) => ({ ...slim(e), stream: ((s) => (s ? { id: s.id, title: s.title } : null))(nearest(e.id)) }));

  // What a user would ask of what this ships and of what holds it. Answered on the release's own build, or not answered:
  // a release that names its version is not helped by what passed on an earlier one.
  const asked = new Set([...from('software.ships', event.id), ...held.filter((r) => isA(byId.get(r.to_id)!, containers))].flatMap((r) => [r.to_id, ...under(r.to_id)]));
  const version = typeof event.props.version === 'string' && event.props.version.trim() ? event.props.version.trim() : undefined;
  const proven = asked.size && askPack ? ((await askPack(l, 'proof', { build: version, within: [...asked] }).catch(() => undefined)) as { build?: string | null; counts?: Record<string, number> & { answered: number; questions: number }; proofs?: (Record<string, unknown> & { tests: unknown })[] } | undefined) : undefined;
  const known = proven?.proofs?.length && proven.counts ? { build: proven.build ?? null, counts: proven.counts, proofs: proven.proofs } : undefined;

  const rank = (i: Item) => (i.done ? 2 : i.yours ? 0 : 1);
  const out = [...streams.values()].map((s) => ({
    ...(s.head ? slim(s.head) : { id: null, type: null, title: null, status: null }),
    relation: s.relation,
    progress: { done: s.items.filter((i) => i.done).length, total: s.items.length },
    yours: s.items.filter((i) => i.yours).length,
    items: s.items.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)),
  }));
  const open = (s: (typeof out)[number]) => s.progress.total - s.progress.done;
  out.sort((a, b) => Number(open(a) === 0) - Number(open(b) === 0) || b.yours - a.yours || open(b) - open(a) || (a.title ?? '').localeCompare(b.title ?? ''));
  const all = out.flatMap((s) => s.items);
  return {
    event: { ...slim(event), open: event.is_open, at: (event.props.at as string | undefined) ?? null },
    counts: { holding: all.length, open: all.filter((i) => !i.done).length, yours: all.filter((i) => i.yours).length, to_sort: toSort.length, can_follow: deferred.length },
    /** Nothing it waits for is still open, and nothing is left to sort. */
    clear: all.every((i) => i.done) && toSort.length === 0 && (!known || known.counts.answered === known.counts.questions),
    /** How we know: the proof questions of what it ships and of what holds it, on the release's build (its version) or, when it names none, the build last reported. */
    proof: known ? { build: known.build, named: Boolean(version), counts: known.counts, questions: known.proofs.map(({ tests: _tests, ...q }) => q) } : null,
    to_sort: toSort.sort((a, b) => (a.stream?.title ?? '').localeCompare(b.stream?.title ?? '') || a.title.localeCompare(b.title)),
    streams: out,
    can_follow: deferred.map((r) => ({ ...slim(byId.get(r.to_id)!), open: byId.get(r.to_id)!.is_open, relation: r.id })),
    how: 'To sort an item: link the event to it with depends_on (the event waits for it) or defers (it can follow). To move one across, unlink the relation given here and link the other.',
  };
}

async function notifications(l: Archipelago) {
  const { rows } = await l.db.query(
    `select n.id, n.title, n.body, n.props->>'level' as level, n.props->>'from' as from, n.created_at,
            a.id as about_id, a.title as about_title
     from entity n
     left join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
     left join entity a on a.id = r.to_id
     where n.type = any($1::text[]) and n.is_open and n.archived_at is null
     order by n.created_at desc limit 100`,
    [l.registry.family('sys.notification')],
  );
  return rows;
}

export interface View {
  description: string;
  run(l: Archipelago, input: Record<string, unknown>): Promise<unknown>;
}

export const VIEWS: Record<string, View> = {
  attention: {
    description:
      'What deserves attention, and why: each item with its reasons, the strongest first. Reasons: waits_on (someone must answer or act), to_confirm (an agent settled it and the owner has not confirmed), holding_up (others are blocked by it), due (its bound is near or past), unsettled (a question not yet settled, and how it settles), blocked (and what has to move first), stale (nobody has changed or confirmed it for stale_days), under_way (a session is on it), ready (work nothing blocks). Each item says what it sits in at the top (top). Params: person ("me", or an id: only what is theirs; everyone when left out), within (an item or place: only what is its), reasons (some of the above), days (due within, 7), stale_days (14), order (latest: what changed most recently first), limit (100). With to_confirm, the answer has to_confirm.upto for the confirmed tool.',
    run: (l, input) => attention(l, input as Input),
  },
  changed_since: {
    description: 'What changed since a moment in time: how many events of each kind, and the newest of them. Long notes are cut to their start, and a change set says its reason once. Params: since (ISO date-time, required), limit (events listed, default 50), full (true for everything whole).',
    run: changedSince,
  },
  graph: {
    description:
      'Nodes and edges for drawing the map. Params: relations (blocking, structure or all), focus (an entity id: show only its neighbourhood), depth (1 to 4, with focus), include_closed, include_system.',
    run: graph,
  },
  hubs: {
    description:
      `The hubs: open items that hold enough to need views of their own, largest first, each with how much it holds (inside), the size at which an item there counts as a hub (at) and how many views it has. An item is a hub when it holds at least its project's hub_at open things (${HUB_AT} when the project does not say; a project still being shaped sets it to 1, so that nearly everything in it is one). A hub with no views is work owed: give it its views with lens items about it. Nothing is stored: this is read off the map each time.`,
    run: async (l) => ({ at: HUB_AT, hubs: await hubs(l) }),
  },
  lens: {
    description:
      'What is in a picture, as data of one fixed shape, whatever is asked: `lens` (the lens as it was read), `items` (each with what it is `inside`, its `place` among those beside it, its `size`, its `state`: blocked, who it waits on, sessions at work; and `within`: the same counted over everything inside it, sent or not), `links` (kind, from, to, and how many each stands for: a link whose end was not sent is moved up to the nearest thing that was) and `rest` (how many items were left out, by reason). The lens is the built-in one, under the view chosen (an item of type lens: about the item the picture is of, or about nothing for any picture), under what is asked here: a field that is named replaces it whole. How it looks is not decided here: `style` is what the map keeps for the page that draws (items of type style, combined the same way), passed on as it is, and `kept` names the lenses and styles that went in. Every lens that applies can be chosen: `views` names them in order (those about the item asked for, then "holding": what the item waits on, step by step, and nothing else, offered while some of it is open; then "when": what is in it placed in time, a week at a time, each person a lane and the sessions on it one more, offered while any of it is dated; then the workspace’s, which are about nothing; each by place); an item opens on its first own view that is not a shortcut, else on "holding" when it is offered, else on what is in it, `view` says which this is (the first, unless lens names another; a field it does not name is the built-in one), one whose own from is another item is a shortcut to there (`to`), `controls` says what the person may change on the page, and `hub` says whether the item holds enough to be a hub. `said` is the lens in words. Params, each optional: lens and style (the id of one kept on the map, used outright; lens "holding" for what holds an item, "when" for when what is in it happens, with time to move the week; "in" for what is in it), from (an entity id; without it, the whole map), kinds (types to keep, or "work"; with a leading "-", to leave out), by (the kind of link that says what is inside what; part_of), over (the kinds of link sent along, or "all"; depends_on and waits_on), far (steps down from the start), lanes (stage, link or person: what each item is filed under, as `lane`), order (the number field that orders things beside each other; order), measure (work or tokens), fold (what to leave out, of: closed, system, unlinked; all three).',
    run: lens,
  },
  tree: {
    description:
      'A tree a pack declares over "is part of", such as software.roadmap: one root and its branches in order, the work under each, progress rolled up, and what is being worked on now. Params: root (an entity id; without it, the roots to choose from), tree (needed only when packs declare more than one).',
    run: tree,
  },

  gate: {
    description:
      'An event as a gate (a release, a launch): what it waits for (everything it depends_on), grouped by stream (the feature or project each is part of) with progress and what the owner owes; what it goes ahead without (what it defers); what is not yet sorted (open tasks, issues and decisions under what it ships, on neither side); and how we know (the proof questions of what it ships and of what holds it, answered or not on the release\u2019s build: its version). Params: event (an entity id; without it, the open events that have a gate).',
    run: gate,
  },

  spent: {
    description: 'What agents spent over the last days, read from their runs: dollars where a run says what it cost, tokens where it does not, by where they ran. The money pack\u2019s costs view adds what is paid regularly. Params: days (default 30).',
    run: spent,
  },
  notifications: {
    description: 'Unread notifications for the human, newest first.',
    run: notifications,
  },
  sessions: {
    description: 'Agent sessions and automation runs: what each open one is working on and holding, whether it has gone quiet, and the last ten that ended.',
    run: sessions,
  },
  brief: {
    description: 'Everything a session needs to start on one task: context, repository, blockers, resources it needs, and the rules that apply. Params: task (required).',
    run: brief,
  },
  saved_views: {
    description: 'Every picture kept on the map (a lens, named by the style that draws it), with what it is a picture of: pinned first, then the newest. Params: limit (100).',
    run: (l, input) => savedViews(l, input as { limit?: number }),
  },
  style: {
    description: 'How a page looks: the style of one item (the presets the packs ship, the workspace’s, its kind’s, its own, nearest last, a named set merged name by name), or with no item the workspace’s; and which styles went in (used). What an item page and the pages that are not pictures are drawn by. Params: of (an entity id).',
    run: (l, input) => pageStyle(l, input),
  },
};
