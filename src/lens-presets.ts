// Lens presets: views a pack declares as a lens (`lens` in its pack.json views), answered by the one lens query
// (src/lens.ts) and read into the form each view has always had, so what an agent or a page asks of them does not
// change. The core pack ships the kernel's own: lens, graph, tree, hubs and attention (Rule 6 of the rework: one way
// to read). A preset's fields are data; what is here only reads its params onto the lens and its answer back out.

import { attention, type Input } from './attention.ts';
import { brief, BRIEF_UP } from './brief.ts';
import { lensRead } from './lens-scan.ts';
import type { LENS_ANSWERS, ViewDef } from './declared.ts';
import { HUB_AT, hubs } from './lens-kept.ts';
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
  const answer = await lens(l, { ...(focus && { from: focus }) }, { ...def.lens, over, fold, ...(focus && { near }) }, false);
  const sent = new Map(answer.items.map((i) => [i.id, i]));
  // The links among them as the map keeps them, in the order it keeps them, which decides what a graph too big to
  // send keeps: walked out from the focus a step at a time, or, without one, as the links come.
  const types = answer.lens.over === 'all' ? null : answer.lens.over;
  const ids = [...sent.keys()];
  const { rows: links } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(
    `select id, type, from_id, to_id from relation where valid_to is null and from_id = any($1::text[]) and to_id = any($1::text[])${types ? ' and type = any($2::text[])' : ''} order by ctid`,
    types ? [ids, types] : [ids],
  );
  let order: string[];
  if (focus) {
    const keep = new Set([focus]);
    for (let d = 0, frontier = [focus]; d < near && frontier.length; d++) {
      const next: string[] = [];
      for (const r of links) for (const [x, y] of [[r.from_id, r.to_id], [r.to_id, r.from_id]]) if (frontier.includes(x) && !keep.has(y)) (keep.add(y), next.push(y));
      frontier = next;
    }
    order = [...keep];
  } else order = [...new Set(links.flatMap((r) => [r.from_id, r.to_id]))];
  const nodes = order.slice(0, GRAPH_LIMIT).map((id) => sent.get(id)!);
  const kept = new Set(nodes.map((n) => n.id));
  const tokens = await rolledTokens(l, nodes.map((n) => n.id));
  return {
    preset,
    focus,
    truncated: order.length > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: order.length } : undefined,
    nodes: nodes.map((i) => {
      const t = tokens.of(i.id);
      return { id: i.id, type: i.type, root: i.root, kind: i.kind, title: i.title, status: i.status, open: i.open, created: t?.created, blocked: i.state.blocked, ...(t?.work && { work: true, tokens: t.tokens, estimated: t.estimated, order: t.order }) };
    }),
    edges: links.filter((r) => kept.has(r.from_id) && kept.has(r.to_id)).map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id })),
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
  // Everything that is part of the nodes, a level at a time: all a roll-up of them reads.
  const parts: { from_id: string; to_id: string }[] = [];
  const seen = new Set(nodes);
  for (let level = nodes; level.length; ) {
    const { rows: found } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null and to_id = any($1::text[])`, [level]);
    parts.push(...found);
    level = [...new Set(found.map((r) => r.from_id))].filter((id) => !seen.has(id) && seen.add(id));
  }
  const { rows } = await l.db.query<{ id: string; type: string; status: string; is_open: boolean; created_at: Date; estimated: unknown; used: unknown; place: unknown }>(
    `select id, type, status, is_open, created_at, props->'tokens_estimated' as estimated, props->'tokens_used' as used, props->'order' as place from entity where archived_at is null and id = any($1::text[])`,
    [[...seen]],
  );
  const all = new Map(rows.map((e) => [e.id, e]));
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
  const answer = await lens(l, { ...(root && { from: root }) }, { ...def.lens, kinds: root ? [...t.roots, ...t.branches, ...t.work] : [...t.roots, ...t.branches], order: t.order }, false);
  const kids = new Map<string, Item[]>();
  for (const i of answer.items) if (i.inside !== null) kids.set(i.inside, [...(kids.get(i.inside) ?? []), i]);
  if (!root) {
    const roots = answer.items.filter((i) => isA(i.type, t.roots)).map((i) => ({ id: i.id, type: i.type, title: i.title, status: i.status, branches: (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const { rows: sessions } = await l.db.query<{ target: string; id: string; title: string }>(
    `select r.to_id as target, s.id, s.title from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null`,
  );
  const props = new Map((await l.db.query<{ id: string; place: unknown; created_at: Date }>(`select id, props->$2 as place, created_at from entity where id = any($1::text[])`, [answer.items.map((i) => i.id), t.order])).rows.map((r) => [r.id, r]));
  // What is under each thing comes as the map keeps its links; branches in their order, then the oldest first.
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null and to_id = any($1::text[]) order by ctid`, [answer.items.map((i) => i.id)]);
  const kept = new Map(parts.map((r, i) => [`${r.from_id} ${r.to_id}`, i]));
  for (const [up, list] of kids) list.sort((a, b) => (kept.get(`${a.id} ${up}`) ?? Infinity) - (kept.get(`${b.id} ${up}`) ?? Infinity));
  const placeOf = (id: string) => (typeof props.get(id)?.place === 'number' ? (props.get(id)!.place as number) : Infinity);
  const age = (id: string) => +new Date(props.get(id)?.created_at ?? 0);
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
    const branches = (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).sort((a, b) => placeOf(a.id) - placeOf(b.id) || age(a.id) - age(b.id)).map((k) => build(k, here));
    const work = (kids.get(i.id) ?? []).filter((k) => !isA(k.type, t.branches) && isA(k.type, t.work)).map((k) => (placed.add(k.id), item(k)));
    now.push(...work.filter((w) => w.active).map((w) => ({ ...w, path: here })));
    const progress = branches.reduce((sum, b) => ({ done: sum.done + b.progress.done, total: sum.total + b.progress.total }), { done: work.filter((w) => !w.open).length, total: work.length });
    const order = props.get(i.id)?.place;
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
    depends: (await l.db.query<{ from: string; to: string }>(`select from_id as "from", to_id as "to" from relation where type = 'depends_on' and valid_to is null and from_id = any($1::text[]) and to_id = any($1::text[]) order by ctid`, [[...placed]])).rows,
  };
}

/** The hubs, by the core pack's lens of them (src/lens-kept.ts), with the size at which an item counts as one where its project does not say. */
const hubsOf: Reading = async (l) => ({ at: HUB_AT, hubs: await hubs(l) });

/**
 * What deserves attention: the state stage of its lens (open work and questions, the links that say what waits on
 * what), answered without drawing the picture. Every lens item's needs_you is read from the same reasons.
 */
/** The one field of an item attention reads: when it is due. */
const DUE = ['due'];
const attend: Reading = async (l, def, params) => attention(l, params as Input, await lensRead(l, {}, { ...def.lens, over: family(l, def.lens?.over) }, {}, DUE, ['status', 'owner', 'updated_at']));

/** Everything a session needs to start on a task: what the lens from the task reads, with what holds the task and what it needs. */
const briefOf: Reading = async (l, def, params) => {
  if (!params.task) throw new Error('brief needs "task": the id of the entity to work on');
  const read = await lensRead(l, { from: String(params.task) }, { ...def.lens, over: family(l, def.lens?.over) }, { up: BRIEF_UP, through: l.registry.relationFamily('needs'), narrow: true });
  return brief(l, { task: String(params.task) }, read);
};

const READINGS: Record<(typeof LENS_ANSWERS)[number], Reading> = {
  lens: (l, def, params) => lens(l, { ...def.lens, ...params }),
  graph,
  tree,
  hubs: hubsOf,
  attention: attend,
  brief: briefOf,
};

/** Answer a lens preset a pack declares: its lens under the params, read as the preset says. */
export function answerPreset(l: Archipelago, def: ViewDef, params: Record<string, unknown>): Promise<unknown> {
  return READINGS[(def.answer ?? 'lens') as keyof typeof READINGS](l, def, params);
}
