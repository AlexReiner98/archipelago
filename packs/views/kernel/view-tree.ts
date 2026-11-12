// The tree view: a tree a pack declares over "is part of" (software.roadmap), read on its own. What is part of the
// root, of the kinds the tree names, each placed inside the nearest of those that holds it (src/inside.ts); or,
// without a root, the roots to choose from. No lens.

import type { KernelContext } from '#pelago/kernel';
import { BlockGraph, type Edge } from './blocks.ts';
import { holders } from './inside.ts';
import { byId, type Link } from './rows.ts';

/** What the system keeps (core's fold `system`): not climbed through. */
const SYSTEM = 'system';

/** Whether an item of this type is the kernel's own. */
const isKernel = (ctx: KernelContext, type: string) => ctx.registry.types.get(type)?.system === true;

/** The most items a tree places: the deepest are cut first. */
const TREE_LIMIT = 2000;

interface Item {
  id: string;
  type: string;
  title: string;
  status: string;
  open: boolean;
  /** The nearest of the tree's kinds that holds it, among those placed. */
  inside: string | null;
  blocked: boolean;
}

/**
 * What is part of a root, at any depth (down the links that say so, through anything), of the kinds named, each
 * inside the nearest of them that holds it: the root first, then down from it a branch at a time.
 */
async function under(ctx: KernelContext, root: string, kinds: string[]): Promise<Item[]> {
  const by = ctx.registry.relationFamily('part_of');
  const seen = new Set([root]);
  for (let level = [root]; level.length; ) {
    const rows = (await ctx.reads({ links: { to: level, types: by } })) as Link[];
    level = rows.map((r) => r.from_id).filter((id) => !seen.has(id) && seen.add(id));
  }
  // What the system keeps is not climbed through; the root is read whatever it is.
  const rows = [...(await byId(ctx, [...seen])).values()].filter((e) => !e.archived_at && (e.id === root || !isKernel(ctx, e.type)));
  if (!rows.some((e) => e.id === root)) throw new Error(`No item "${root}"`);
  const kept = new Map(rows.filter((e) => e.id === root || kinds.some((k) => ctx.registry.isA(e.type, k))).map((e) => [e.id, e]));
  const ids = rows.map((e) => e.id);
  const links = (await ctx.reads({ links: { among: ids, types: ['part_of'], order: 'id' } })) as Link[];
  const { parent, depths, kids } = holders(links, 'part_of', new Set(ids), kept, root);
  let sent = new Set<string>();
  const reach = (id: string) => {
    sent.add(id);
    for (const kid of kids.get(id) ?? []) if (!sent.has(kid)) reach(kid);
  };
  reach(root);
  if (sent.size > TREE_LIMIT) sent = new Set([...sent].sort((a, b) => depths.get(a)! - depths.get(b)!).slice(0, TREE_LIMIT));
  const blocked = new BlockGraph((await ctx.reads({ blocks: ids })) as Edge[]);
  return [...sent].map((id) => {
    const e = kept.get(id)!;
    const up = parent.get(id);
    return { id, type: e.type, title: e.title, status: e.status, open: e.is_open, inside: up !== undefined && sent.has(up) ? up : null, blocked: blocked.isBlocked(id) };
  });
}

/** The items of the kinds named across the map (the newest, by the index on type), each inside the nearest of them that holds it. */
async function tops(ctx: KernelContext, kinds: string[]): Promise<Item[]> {
  const types = [...ctx.registry.types.keys()].filter((t) => kinds.some((k) => ctx.registry.isA(t, k)));
  const { entities, relations } = (await ctx.reads({ kinds: { types, fold: [SYSTEM], by: 'part_of', over: [] } })) as { entities: { id: string; type: string; title: string; status: string; is_open: boolean }[]; relations: { type: string; from_id: string; to_id: string }[] };
  const kept = new Map(entities.map((e) => [e.id, e]));
  const { parent } = holders(relations, 'part_of', new Set(kept.keys()), kept);
  return entities.map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, open: e.is_open, inside: parent.get(e.id) ?? null, blocked: false }));
}

/**
 * The tree meant when none is named: the only one there is, or else the only one the root can stand in (its type
 * among the tree's roots or branches), or with no root the only one whose roots have items on the map. Where a root
 * stands in several (a feature, a branch of two roadmaps), the one of them whose roots have items on the map.
 */
async function treeFor(ctx: KernelContext, root: string | undefined, isA: (type: string, kinds: string[]) => boolean) {
  const defs = [...ctx.registry.trees.values()];
  if (defs.length <= 1) return defs[0];
  const type = root ? ((await ctx.reads({ get: root })) as { type: string } | null)?.type : undefined;
  const used = async (d: (typeof defs)[number]) => anyOf(ctx, [...ctx.registry.types.keys()].filter((t) => isA(t, d.roots)));
  const kept = [];
  for (const d of defs) if (type ? isA(type, [...d.roots, ...d.branches]) : await used(d)) kept.push(d);
  if (kept.length <= 1 || !type) return kept.length === 1 ? kept[0] : undefined;
  const rooted = [];
  for (const d of kept) if (await used(d)) rooted.push(d);
  return rooted.length === 1 ? rooted[0] : undefined;
}

/** Whether any item of these types is on the map, archived ones aside: one of each type asked, until one is found. */
async function anyOf(ctx: KernelContext, types: string[]) {
  for (const type of types) if (((await ctx.reads({ items: { type }, page: { size: 1 } })) as { rows: unknown[] }).rows.length) return true;
  return false;
}

/**
 * A tree a pack declares over "is part of", read from what is part of one root: its branches in order,
 * the work under each, progress rolled up from that work, and where work is happening now. Without a root, the
 * roots there are to choose from.
 */
export async function tree(ctx: KernelContext, params: Record<string, unknown>) {
  const defs = ctx.registry.trees;
  const isA = (type: string, kinds: string[]) => kinds.some((kind) => ctx.registry.isA(type, kind));
  const t = params.tree ? defs.get(String(params.tree)) : await treeFor(ctx, params.root === undefined ? undefined : String(params.root), isA);
  if (!t) throw new Error(`tree must be one of: ${[...defs.keys()].join(', ')}`);
  const about = { id: t.id, title: t.title };
  const root = params.root === undefined ? undefined : String(params.root);
  const answer = { items: root ? await under(ctx, root, [...t.roots, ...t.branches, ...t.work]) : await tops(ctx, [...t.roots, ...t.branches]) };
  const kids = new Map<string, Item[]>();
  for (const i of answer.items) if (i.inside !== null) kids.set(i.inside, [...(kids.get(i.inside) ?? []), i]);
  if (!root) {
    const roots = answer.items.filter((i) => isA(i.type, t.roots)).map((i) => ({ id: i.id, type: i.type, title: i.title, status: i.status, branches: (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const works = (await ctx.reads({ links: { to: answer.items.map((i) => i.id), types: ['works_on'] } })) as Link[];
  const at = await byId(ctx, [...new Set(works.map((w) => w.from_id))]);
  const sessions = works.flatMap((w) => { const s = at.get(w.from_id); return s && s.is_open && !s.archived_at ? [{ target: w.to_id, id: s.id, title: s.title }] : []; });
  const props = new Map([...(await byId(ctx, answer.items.map((i) => i.id))).values()].map((e) => [e.id, { id: e.id, place: t.order === undefined ? null : (e.props?.[t.order] ?? null), created_at: e.created_at }]));
  // What is under each thing comes as the map keeps its links; branches in their order, then the oldest first.
  const parts = (await ctx.reads({ links: { to: answer.items.map((i) => i.id), types: ['part_of'], order: 'kept' } })) as Link[];
  const kept = new Map(parts.map((r, i) => [`${r.from_id} ${r.to_id}`, i]));
  for (const [up, list] of kids) list.sort((a, b) => (kept.get(`${a.id} ${up}`) ?? Infinity) - (kept.get(`${b.id} ${up}`) ?? Infinity));
  const placeOf = (id: string) => (typeof props.get(id)?.place === 'number' ? (props.get(id)!.place as number) : Infinity);
  const age = (id: string) => +new Date(props.get(id)?.created_at ?? 0);
  const item = (i: Item) => {
    const on = sessions.filter((s) => s.target === i.id).map(({ id, title }) => ({ id, title }));
    return { id: i.id, type: i.type, title: i.title, status: i.status, open: i.open, blocked: i.blocked, sessions: on, active: on.length > 0 || t.active.includes(i.status) };
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
    depends: ((await ctx.reads({ links: { among: [...placed], types: ['depends_on'], order: 'kept' } })) as Link[]).map((r) => ({ from: r.from_id, to: r.to_id })),
  };
}

