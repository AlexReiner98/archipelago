// Lens presets: views a pack declares as a lens (`lens` in its pack.json views), answered by the one lens query
// (src/lens.ts) and read into the form each view has always had, so what an agent or a page asks of them does not
// change. The core pack ships the kernel's own: lens, graph, tree, hubs and attention (Rule 6 of the rework: one way
// to read). A preset's fields are data; what is here only reads its params onto the lens and its answer back out.

import { attention, type Input } from './attention.ts';
import type { LENS_ANSWERS, ViewDef } from './declared.ts';
import { HUB_AT, keptOf } from './lens-kept.ts';
import { lens } from './lens.ts';
import type { Archipelago } from './pelago.ts';

type Answer = Awaited<ReturnType<typeof lens>>;
type Item = Answer['items'][number];
type Reading = (l: Archipelago, def: ViewDef, params: Record<string, unknown>) => Promise<unknown>;

/** The fields one value of a param stands for, as the preset declares them. */
function chosen(def: ViewDef, param: string, value: string): Record<string, unknown> {
  const choices = def.choices?.[param] ?? {};
  if (!(value in choices)) throw new Error(`\`${param}\` must be one of: ${Object.keys(choices).join(', ')}`);
  return choices[value];
}

/** Each kind of link a preset names, with every kind of link that extends it. */
const family = (l: Archipelago, over: unknown) => (Array.isArray(over) ? l.registry.relationFamily(...over.map(String)) : over);

/** The most nodes a graph sends. */
const GRAPH_LIMIT = 400;

/**
 * Nodes and edges: the lens over the links the preset's `relations` names, from a focus `near` steps either way or
 * the whole map, each node with its tokens rolled up over everything that is part of it.
 */
async function graph(l: Archipelago, def: ViewDef, params: Record<string, unknown>) {
  const focus = params.focus === undefined ? undefined : String(params.focus);
  const preset = String(params.relations ?? (focus ? 'all' : 'blocking'));
  const fold = [...(params.include_closed ? [] : ['closed']), ...(params.include_system ? [] : ['system'])];
  const over = family(l, chosen(def, 'relations', preset).over);
  const near = Math.min(Math.max(Number(params.depth ?? 2) || 2, 1), 4);
  const answer = await lens(l, { ...(focus && { from: focus }) }, { ...def.lens, over, fold, ...(focus && { near }) });
  const by = answer.lens.by;
  const along = (kind: string) => answer.lens.over === 'all' || answer.lens.over.includes(kind);
  // What is inside what is said by `inside`, not as a link: here it is an edge like any other.
  const edges = [
    ...answer.items.filter((i) => i.inside !== null && along(by)).map((i) => ({ type: by, from: i.id, to: i.inside! })),
    ...answer.links.map((k) => ({ type: k.kind, from: k.from, to: k.to })),
  ].map((e) => ({ id: `${e.type} ${e.from} ${e.to}`, ...e }));
  // Without a focus, a thing nothing connects to adds nothing to a graph.
  const tied = new Set(edges.flatMap((e) => [e.from, e.to]));
  const all = answer.items.filter((i) => focus || tied.has(i.id));
  const nodes = all.slice(0, GRAPH_LIMIT);
  const kept = new Set(nodes.map((n) => n.id));
  const tokens = await rolledTokens(l, nodes.map((n) => n.id));
  return {
    preset,
    focus,
    truncated: all.length > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: all.length } : undefined,
    nodes: nodes.map((i) => {
      const t = tokens.of(i.id);
      return { id: i.id, type: i.type, root: i.root, kind: i.kind, title: i.title, status: i.status, open: i.open, created: t?.created, blocked: i.state.blocked, ...(t?.work && { work: true, tokens: t.tokens, estimated: t.estimated, order: t.order }) };
    }),
    edges: edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
  };
}

/**
 * Tokens: what each thing is expected to take and has taken, with everything that is part of it, in sight or not.
 * A thing with parts is expected to take the sum of what they are; its own estimate stands only while none of its
 * parts has one. Where some parts have an estimate and some have not, the sum is short, and says so (`partial`).
 */
async function rolledTokens(l: Archipelago, nodes: string[]) {
  // Only work is counted: what can be estimated, and what such things are part of. And the nodes, for when each was made.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || l.registry.isA(type, 'work');
  const workTypes = [...l.registry.types.keys()].filter(work);
  const { rows } = await l.db.query<{ id: string; type: string; status: string; is_open: boolean; created_at: Date; estimated: unknown; used: unknown; place: unknown }>(
    `select id, type, status, is_open, created_at, props->'tokens_estimated' as estimated, props->'tokens_used' as used, props->'order' as place from entity where archived_at is null and (type = any($1::text[]) or id = any($2::text[]))`,
    [workTypes, nodes],
  );
  const all = new Map(rows.map((e) => [e.id, e]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null`);
  const partsOf = new Map<string, string[]>();
  for (const p of parts) if (all.has(p.from_id)) partsOf.set(p.to_id, [...(partsOf.get(p.to_id) ?? []), p.from_id]);
  type Tokens = { estimated: number; used: number; assumed?: boolean; partial?: boolean };
  const totals = new Map<string, Tokens>();
  // A feature that is built is done, though it stays open until it ships.
  const done = (id: string) => Boolean(all.get(id)) && (!all.get(id)!.is_open || all.get(id)!.status === 'built');
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
    const own = all.get(id);
    const ofParts = inside.reduce((n, t) => n + t.estimated, 0);
    const sum: Tokens = { estimated: ofParts || Number(own?.estimated ?? 0), used: Number(own?.used ?? 0) + inside.reduce((n, t) => n + t.used, 0) };
    if (ofParts && inside.some((t) => !t.estimated || t.partial)) sum.partial = true;
    // What is finished has been paid for. Where nothing measured it, it is taken to have used what it was expected to.
    if (done(id) && !sum.used && sum.estimated) Object.assign(sum, { used: sum.estimated, assumed: true });
    else if (inside.some((t) => t.assumed)) sum.assumed = true;
    totals.set(id, sum);
    return sum;
  };
  return {
    of: (id: string) => {
      const e = all.get(id);
      if (!e) return undefined;
      const isWork = work(e.type);
      return { created: e.created_at, work: isWork, ...(isWork && { tokens: tokens(id), estimated: e.estimated != null, order: typeof e.place === 'number' ? e.place : undefined }) };
    },
  };
}

/**
 * A tree a pack declares over "is part of", read from the lens of its kinds from one root: its branches in order,
 * the work under each, progress rolled up from that work, and where work is happening now. Without a root, the
 * roots there are to choose from.
 */
async function tree(l: Archipelago, def: ViewDef, params: Record<string, unknown>) {
  const defs = l.registry.trees;
  const t = params.tree ? defs.get(String(params.tree)) : defs.size === 1 ? [...defs.values()][0] : undefined;
  if (!t) throw new Error(`tree must be one of: ${[...defs.keys()].join(', ')}`);
  const isA = (type: string, kinds: string[]) => kinds.some((kind) => l.registry.isA(type, kind));
  const about = { id: t.id, title: t.title };
  const root = params.root === undefined ? undefined : String(params.root);
  const answer = await lens(l, { ...(root && { from: root }) }, { ...def.lens, kinds: root ? [...t.roots, ...t.branches, ...t.work] : [...t.roots, ...t.branches], order: t.order });
  const kids = new Map<string, Item[]>();
  for (const i of answer.items) if (i.inside !== null) kids.set(i.inside, [...(kids.get(i.inside) ?? []), i]);
  for (const list of kids.values()) list.sort((a, b) => a.place - b.place);
  if (!root) {
    const roots = answer.items.filter((i) => isA(i.type, t.roots)).map((i) => ({ id: i.id, type: i.type, title: i.title, status: i.status, branches: (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const { rows: sessions } = await l.db.query<{ target: string; id: string; title: string }>(
    `select r.to_id as target, s.id, s.title from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null`,
  );
  const props = new Map((await l.db.query<{ id: string; place: unknown }>(`select id, props->$2 as place from entity where id = any($1::text[])`, [answer.items.map((i) => i.id), t.order])).rows.map((r) => [r.id, r.place]));
  const item = (i: Item) => {
    const on = sessions.filter((s) => s.target === i.id).map(({ id, title }) => ({ id, title }));
    return { id: i.id, type: i.type, title: i.title, status: i.status, open: i.open, blocked: i.state.blocked, sessions: on, active: on.length > 0 || t.active.includes(i.status) };
  };
  type Row = ReturnType<typeof item>;
  interface Branch extends Row {
    order: number | null;
    progress: { done: number; total: number };
    branches: Branch[];
    work: Row[];
  }
  const now: (Row & { path: string[] })[] = [];
  // What the tree places: what is inside an item of another kind (a project in the project) is not in it.
  const placed = new Set<string>();
  const top = answer.items.find((i) => i.id === root)!;
  const build = (i: Item, path: string[]): Branch => {
    const self = item(i);
    placed.add(i.id);
    if (self.active && i !== top) now.push({ ...self, path });
    const here = i === top ? [] : [...path, i.title];
    const branches = (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).map((k) => build(k, here));
    const work = (kids.get(i.id) ?? []).filter((k) => !isA(k.type, t.branches) && isA(k.type, t.work)).map((k) => (placed.add(k.id), item(k)));
    now.push(...work.filter((w) => w.active).map((w) => ({ ...w, path: here })));
    const progress = branches.reduce((sum, b) => ({ done: sum.done + b.progress.done, total: sum.total + b.progress.total }), { done: work.filter((w) => !w.open).length, total: work.length });
    const order = props.get(i.id);
    return { ...self, active: self.active || work.some((w) => w.active) || branches.some((b) => b.active), order: typeof order === 'number' ? order : null, progress, branches, work };
  };
  const built = build(top, []);
  const flat = (b: Branch): Branch[] => [b, ...b.branches.flatMap(flat)];
  const by_status: Record<string, number> = {};
  for (const b of built.branches.flatMap(flat)) by_status[b.status] = (by_status[b.status] ?? 0) + 1;
  return {
    tree: about,
    root: { id: built.id, type: built.type, title: built.title, status: built.status },
    progress: built.progress,
    by_status,
    now,
    branches: built.branches,
    /** Work that belongs to the root but to no branch of it. */
    unplaced: built.work,
    /** What waits on what, within this tree: "from" cannot finish until "to" has. */
    // The links themselves: a lens moves a link whose end it did not send up to what holds it, which here would say what does not wait.
    depends: (await l.db.query<{ from: string; to: string }>(`select from_id as "from", to_id as "to" from relation where type = 'depends_on' and valid_to is null`)).rows.filter((d) => placed.has(d.from) && placed.has(d.to)),
  };
}

/**
 * The hubs: open items that hold enough to need views of their own, read from the lens of the whole map. How much is
 * enough is the nearest project's hub_at, or HUB_AT. Nothing says an item is a hub that could go stale.
 */
async function hubs(l: Archipelago, def: ViewDef) {
  const answer = await lens(l, {}, def.lens);
  const { rows } = await l.db.query<{ id: string; at: number }>(`select id, (props->>'hub_at')::float8 as at from entity where archived_at is null and jsonb_typeof(props->'hub_at') = 'number'`);
  const set = new Map(rows.map((r) => [r.id, r.at]));
  const up = new Map(answer.items.map((i) => [i.id, i.inside]));
  const at = (id: string): number => {
    for (let cur: string | null | undefined = id, steps = 0; cur && steps < 64; cur = up.get(cur), steps++) if (set.has(cur)) return set.get(cur)!;
    return HUB_AT;
  };
  const views = new Map<string, number>();
  for (const kept of await keptOf(l, 'lens', undefined)) for (const id of kept.about) views.set(id, (views.get(id) ?? 0) + 1);
  const found = answer.items
    .map((i) => ({ id: i.id, type: i.type, title: i.title, inside: i.within.items, at: at(i.id), views: views.get(i.id) ?? 0 }))
    .filter((h) => h.inside > 0 && h.inside >= h.at)
    .sort((a, b) => b.inside - a.inside || a.title.localeCompare(b.title));
  return { at: HUB_AT, hubs: found };
}

/**
 * What deserves attention: the lens's state, asked alone. Every lens item's needs_you is read from these same
 * reasons (src/attention.ts); asked for itself, the state of open work is answered without drawing a picture of
 * the map around it, which would double what it costs.
 */
const attend: Reading = (l, _def, params) => attention(l, params as Input);

const READINGS: Record<(typeof LENS_ANSWERS)[number], Reading> = {
  lens: (l, def, params) => lens(l, { ...def.lens, ...params }),
  graph,
  tree,
  hubs,
  attention: attend,
};

/** Answer a lens preset a pack declares: its lens under the params, read as the preset says. */
export function answerPreset(l: Archipelago, def: ViewDef, params: Record<string, unknown>): Promise<unknown> {
  return READINGS[(def.answer ?? 'lens') as keyof typeof READINGS](l, def, params);
}
