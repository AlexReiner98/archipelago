// The tree view: a tree a pack declares over "is part of" (software.roadmap), read on its own. What is part of the
// root, of the kinds the tree names, each placed inside the nearest of those that holds it (src/inside.ts); or,
// without a root, the roots to choose from. No lens.

import { blockGraph } from './blocking.ts';
import { SYSTEM } from './head.ts';
import { holders } from './inside.ts';
import type { Archipelago } from './pelago.ts';
import { scanKinds } from './region.ts';

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
async function under(l: Archipelago, root: string, kinds: string[]): Promise<Item[]> {
  const by = l.registry.relationFamily('part_of');
  const seen = new Set([root]);
  for (let level = [root]; level.length; ) {
    const { rows } = await l.db.query<{ id: string }>(`select r.from_id as id from relation r join unnest($1::text[]) s(id) on s.id = r.to_id where r.valid_to is null and r.type = any($2::text[])`, [level, by]);
    level = rows.map((r) => r.id).filter((id) => !seen.has(id) && seen.add(id));
  }
  // What the system keeps is not climbed through; the root is read whatever it is.
  const { rows } = await l.db.query<{ id: string; type: string; title: string; status: string; is_open: boolean }>(
    `select id, type, title, status, is_open from entity where archived_at is null and id = any($1::text[]) and (id = $2 or kind is null or kind <> '${SYSTEM}')`,
    [[...seen], root],
  );
  if (!rows.some((e) => e.id === root)) throw new Error(`No item "${root}"`);
  const kept = new Map(rows.filter((e) => e.id === root || kinds.some((k) => l.registry.isA(e.type, k))).map((e) => [e.id, e]));
  const ids = rows.map((e) => e.id);
  const { rows: links } = await l.db.query<{ type: string; from_id: string; to_id: string }>(`with s(id) as (select unnest($1::text[])) select r.type, r.from_id, r.to_id from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null and r.type = 'part_of' order by r.id`, [ids]);
  const { parent, depths, kids } = holders(links, 'part_of', new Set(ids), kept, root);
  let sent = new Set<string>();
  const reach = (id: string) => {
    sent.add(id);
    for (const kid of kids.get(id) ?? []) if (!sent.has(kid)) reach(kid);
  };
  reach(root);
  if (sent.size > TREE_LIMIT) sent = new Set([...sent].sort((a, b) => depths.get(a)! - depths.get(b)!).slice(0, TREE_LIMIT));
  const blocked = await blockGraph(l, ids);
  return [...sent].map((id) => {
    const e = kept.get(id)!;
    const up = parent.get(id);
    return { id, type: e.type, title: e.title, status: e.status, open: e.is_open, inside: up !== undefined && sent.has(up) ? up : null, blocked: blocked.isBlocked(id) };
  });
}

/** The items of the kinds named across the map (the newest, by the index on type), each inside the nearest of them that holds it. */
async function tops(l: Archipelago, kinds: string[]): Promise<Item[]> {
  const types = [...l.registry.types.keys()].filter((t) => kinds.some((k) => l.registry.isA(t, k)));
  const { entities, relations } = await scanKinds(l, { types, fold: [SYSTEM], by: 'part_of', over: [] });
  const kept = new Map(entities.map((e) => [e.id, e]));
  const { parent } = holders(relations, 'part_of', new Set(kept.keys()), kept);
  return entities.map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, open: e.is_open, inside: parent.get(e.id) ?? null, blocked: false }));
}

/**
 * A tree a pack declares over "is part of", read from what is part of one root: its branches in order,
 * the work under each, progress rolled up from that work, and where work is happening now. Without a root, the
 * roots there are to choose from.
 */
export async function tree(l: Archipelago, params: Record<string, unknown>) {
  const defs = l.registry.trees;
  const t = params.tree ? defs.get(String(params.tree)) : defs.size === 1 ? [...defs.values()][0] : undefined;
  if (!t) throw new Error(`tree must be one of: ${[...defs.keys()].join(', ')}`);
  const isA = (type: string, kinds: string[]) => kinds.some((kind) => l.registry.isA(type, kind));
  const about = { id: t.id, title: t.title };
  const root = params.root === undefined ? undefined : String(params.root);
  const answer = { items: root ? await under(l, root, [...t.roots, ...t.branches, ...t.work]) : await tops(l, [...t.roots, ...t.branches]) };
  const kids = new Map<string, Item[]>();
  for (const i of answer.items) if (i.inside !== null) kids.set(i.inside, [...(kids.get(i.inside) ?? []), i]);
  if (!root) {
    const roots = answer.items.filter((i) => isA(i.type, t.roots)).map((i) => ({ id: i.id, type: i.type, title: i.title, status: i.status, branches: (kids.get(i.id) ?? []).filter((k) => isA(k.type, t.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const { rows: sessions } = await l.db.query<{ target: string; id: string; title: string }>(
    `select r.to_id as target, s.id, s.title from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null and r.to_id = any($1::text[])`,
    [answer.items.map((i) => i.id)],
  );
  const props = new Map((await l.db.query<{ id: string; place: unknown; created_at: Date }>(`select e.id, e.props->$2 as place, e.created_at from entity e join unnest($1::text[]) s(id) on s.id = e.id`, [answer.items.map((i) => i.id), t.order])).rows.map((r) => [r.id, r]));
  // What is under each thing comes as the map keeps its links; branches in their order, then the oldest first.
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select r.from_id, r.to_id from relation r join unnest($1::text[]) s(id) on s.id = r.to_id where r.type = 'part_of' and r.valid_to is null order by r.ctid`, [answer.items.map((i) => i.id)]);
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
    depends: (await l.db.query<{ from: string; to: string }>(`with s(id) as (select unnest($1::text[])) select r.from_id as "from", r.to_id as "to" from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.type = 'depends_on' and r.valid_to is null order by r.ctid`, [[...placed]])).rows,
  };
}

