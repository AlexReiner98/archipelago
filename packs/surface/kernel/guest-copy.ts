// Make it yours: a guest map that starts as a copy of a shared map, its look and its words included (the owner, 13
// Nov 2026, e_8yd7wh5r: "Yes, copy them"). What comes is what the public view shows anyone, read through the function
// a reader's page is (./public-views.ts), so nothing private comes with it: its items, each as its type, title,
// status and the words shown of it, and the links between them. Beside them, what makes them look as they were shared:
// - each type they are of, as the map that shared them declares it: a type of its own (define_type), a pack kept on
//   that map (its types and link types shown, as a pack kept on this one), or a server's pack (turned on here);
// - an island for each pack, as there, so each item lives where its type does;
// - each view shared, its query and its style, and the style and layout items it names.
// A server's pack that reaches outside the map or runs on a schedule is not turned on for a guest: its types come
// as data, in a pack kept on the map named <pack>_data, and turning the pack itself on waits for sign-in.

import { setPack } from '../../loader/kernel/packstate.ts';
import { parts } from '../../loader/kernel/manifest.ts';
import { KERNEL_PACKS } from '../../loader/kernel/packorder.ts';
import { livesOnIsland } from '../../loader/kernel/island-items.ts';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { publicView } from './public-views.ts';

type Shown = { id: string; type: string; title: string; status?: string | null; body?: string; gist?: string; inside?: string | null; island?: string | null };
type Link = { from: string; to: string; type: string };
type Frozen = { type?: string; title?: string; status?: string; types?: Record<string, string>; parts?: { section?: Shown }[]; lenses?: Record<string, { items?: Shown[]; links?: Link[] }> };
type Def = { id: string; extends?: string; from?: string[]; to?: string[] } & Record<string, unknown>;
type Ops = Record<string, unknown>[];

/** Apply a change here and answer what it made: a copy is made at once, or not at all. */
async function made_(to: Archipelago, actor: Actor, reason: string, ops: Ops): Promise<Record<string, string>> {
  const done = (await to.change(actor, { reason, ops } as never)) as { status: string; created?: Record<string, string> };
  if (done.status !== 'applied') throw new Error(`${reason}: not applied (${done.status}).`);
  return done.created ?? {};
}

/** Where a shared map is: /p/<workspace>/<id>, or that address whole. */
export function sharedAt(from: unknown): { workspace: string; id: string } | undefined {
  const at = typeof from === 'string' ? /\/p\/([a-z0-9][a-z0-9-]{0,62})\/(e_[a-z0-9]{8})\/?$/.exec(from) : null;
  return at ? { workspace: at[1], id: at[2] } : undefined;
}

/** One item of the map that shared, by the field it is found by: a type, a pack, an island. */
const itemBy = async (l: Archipelago, type: string, field: string, value: string) =>
  (await l.db.query<{ id: string; title: string; body: string; props: Record<string, unknown> }>(`select id, title, body, props from entity where type = $1 and props->>'${field}' = $2 and archived_at is null limit 1`, [type, value])).rows[0];

/** The packs a guest map does not turn on: those that reach outside the map or run on a schedule (./guest-gate.ts). */
const outward = (l: Archipelago, pack: string) => {
  const file = l.registry.found.find((p) => p.id === pack);
  const p = file && parts(file);
  return Boolean(p && (p.hosts.length || p.secrets.length || p.webhooks.length || p.via.length || p.server || p.schedules.length));
};

/** Copy what a public view shows, and what makes it look as it does, into `to` as `actor`: at most `most` items. The number copied. */
export async function copyShared(from: Archipelago, id: string, to: Archipelago, actor: Actor, most: number): Promise<number> {
  const doc = (await publicView(from, id)) as Frozen | null;
  if (!doc) throw new Error('Nothing is shared at that address.');
  const src = from.registry, system = new Set(src.family('system'));

  // What is drawn: the item shared first, a document's sections part of it, then what each view draws.
  const items = new Map<string, Shown>(), links: Link[] = [];
  items.set(id, { id, type: doc.type ?? 'work', title: doc.title ?? 'Shared map', status: doc.status });
  for (const part of doc.parts ?? []) if (part.section && part.section.id !== id) { items.set(part.section.id, part.section); links.push({ from: part.section.id, to: id, type: 'part_of' }); }
  for (const lens of Object.values(doc.lenses ?? {})) {
    for (const item of lens.items ?? []) { if (!items.has(item.id)) items.set(item.id, item); if (item.inside) links.push({ from: item.id, to: item.inside, type: 'part_of' }); }
    links.push(...(lens.links ?? []));
  }
  const kept = [...items.values()].filter((i) => !system.has(i.type)).slice(0, most);
  if (!kept.length) return 0;

  // The packs they are of, and what each becomes here.
  const asType = new Map<string, string>(), defs: Ops = [], made = new Map<string, { title: string; types: Def[]; links: Def[] }>(), turnOn = new Set<string>();
  const declared = async (pack: string): Promise<{ types: Def[]; links: Def[] } | undefined> => {
    const item = await itemBy(from, 'pack', 'name', pack); // a pack kept on that map
    const file = item ? (item.props.manifest as { types?: Def[]; links?: Def[] }) : src.found.find((p) => p.id === pack);
    return file && { types: (file.types ?? []) as Def[], links: (file.links ?? []) as Def[] };
  };
  const take = async (name: string, kind: 'types' | 'links') => {
    const def = kind === 'types' ? src.type(name) : src.relations.get(name);
    // What is already in use here stays as it is: the kernel's own, or a type of a pack that is on here.
    if (!def || KERNEL_PACKS.includes(def.pack) || to.registry.states.get(def.pack)?.state === 'active') return asType.set(name, name);
    if (def.pack === 'local' && kind === 'types') {
      const t = await itemBy(from, 'type', 'name', name);
      if (t) defs.push({ op: 'define_type', type: { id: name, title: t.title, description: t.body || t.title, ...Object.fromEntries(['extends', 'fields', 'statuses', 'deliverable'].filter((k) => t.props[k] !== undefined).map((k) => [k, t.props[k]])) } });
      return asType.set(name, t ? name : 'work');
    }
    const server = Boolean(to.registry.found.find((p) => p.id === def.pack)) && !(await itemBy(from, 'pack', 'name', def.pack));
    if (server && !outward(to, def.pack)) { turnOn.add(def.pack); return asType.set(name, name); }
    // A pack kept on that map, or a server's that waits for sign-in here: its parts shown come as a pack kept on this one.
    const here = server ? `${def.pack}_data` : def.pack, whole = await declared(def.pack);
    const found = whole?.[kind].find((d) => d.id === name);
    if (!found) return asType.set(name, kind === 'types' ? 'work' : '');
    const into = made.get(here) ?? { title: src.found.find((p) => p.id === def.pack)?.title ?? def.pack, types: [], links: [] };
    into[kind].push(found);
    made.set(here, into);
    return asType.set(name, here === def.pack ? name : `${here}.${name.startsWith(`${def.pack}.`) ? name.slice(def.pack.length + 1) : name}`);
  };
  for (const t of new Set(kept.map((i) => i.type))) await take(t, 'types');
  const ids = new Set(kept.map((i) => i.id));
  const linked = links.filter((k) => ids.has(k.from) && ids.has(k.to) && k.from !== k.to);
  for (const t of new Set(linked.map((k) => k.type))) await take(t, 'links');
  const rename = (name: string) => asType.get(name) ?? name;
  for (const [name, pack] of made) {
    // Every name in a definition that became another here (its own id, what it extends, what a link joins) is put as it is here.
    const re = (d: Def): Def => JSON.parse(JSON.stringify(d).replace(/"([a-z][a-z0-9_.]*)"/g, (whole, word: string) => (asType.has(word) ? `"${rename(word)}"` : whole)));
    defs.push({ op: 'create', type: 'pack', title: pack.title, body: `Copied with a shared map: the ${pack.types.length ? 'types' : 'link types'} it showed.`, props: { name, manifest: { types: pack.types.map(re), links: pack.links.map(re) } } });
    turnOn.add(name);
  }
  if (defs.length) await made_(to, actor, 'The types of a shared map', defs);
  for (const pack of turnOn) await setPack(to, actor, { pack, on: true });

  // An island for each pack whose types its items are of here, so each lives where its type does; the shared set's
  // are placed as any new item is.
  const shared = new Set(to.registry.found.filter((p) => KERNEL_PACKS.includes(p.id)).flatMap((p) => (p as { shared?: string[] }).shared ?? []));
  const packOf = (i: Shown) => {
    const t = to.registry.type(rename(i.type));
    return t && livesOnIsland(t) && !KERNEL_PACKS.includes(t.pack) && !shared.has(t.id) ? t.pack : undefined;
  };
  const islands = new Map<string, string>(), islandOps: Ops = [];
  for (const pack of new Set(kept.map(packOf).filter((p): p is string => Boolean(p)))) {
    islandOps.push({ op: 'create', ref: pack, type: 'island', title: made.get(pack)?.title ?? to.registry.found.find((p) => p.id === pack)?.title ?? pack, props: { pack } });
  }
  if (islandOps.length) for (const [pack, island] of Object.entries(await made_(to, actor, 'The islands of a shared map', islandOps))) islands.set(pack, island);
  const islandOf = async (i: Shown) => islands.get(packOf(i) ?? '');

  // The items and the links between them.
  const ops: Ops = [];
  for (const i of kept) {
    const type = rename(i.type), statuses = to.registry.type(type)?.statuses;
    const status = i.status && statuses && [...statuses.open, ...statuses.closed].includes(i.status) ? i.status : undefined;
    const body = (i.body ?? i.gist ?? '').trim(), island = await islandOf(i);
    ops.push({ op: 'create', ref: i.id, type: to.registry.type(type) ? type : 'work', title: i.title.slice(0, 60), ...(body && { body }), ...(status && { status }), ...(island && { props: { island } }) });
  }
  const seen = new Set<string>();
  for (const k of linked) {
    const type = rename(k.type), key = `${type} ${k.from} ${k.to}`;
    if (!type || seen.has(key) || !to.registry.relations.has(type)) continue;
    seen.add(key);
    ops.push({ op: 'link', type, from: k.from, to: k.to });
  }
  const copied = await made_(to, actor, `Made from "${doc.title ?? 'a shared map'}"`, ops);
  await copyViews(from, Object.keys(doc.lenses ?? {}), to, actor, { ...copied, ...Object.fromEntries([...asType].filter(([a, b]) => a !== b)) });
  return kept.length;
}

/**
 * Each view shared, with its query and its style, and the style and layout items it names, every id and type name in
 * them put as they are here (`as`: what each id and type of the map that shared became).
 */
async function copyViews(from: Archipelago, lenses: string[], to: Archipelago, actor: Actor, as: Record<string, string>) {
  const items = new Map<string, { type: string; title: string; body: string; props: Record<string, unknown> }>();
  const named = (props: Record<string, unknown>) => [((props.style ?? {}) as { style?: unknown }).style, props.layout].filter((x): x is string => typeof x === 'string' && /^e_[a-z0-9]{8}$/.test(x));
  const want = [...lenses];
  while (want.length) {
    const id = want.shift()!;
    if (items.has(id)) continue;
    const e = await from.entity(id);
    if (!e || !['lens', 'style', 'layout'].includes(e.type)) continue;
    items.set(id, { type: e.type, title: e.title, body: e.body ?? '', props: e.props });
    want.push(...named(e.props));
  }
  // Made in order, so each names what is already here: a layout, then a style that draws with it, then a view.
  const KEEP: Record<string, string[] | null> = { layout: ['code', 'writes', 'modules', 'settings', 'preset'], style: null, lens: ['filter', 'walk', 'limit', 'time', 'sessions', 'view', 'style', 'place'] };
  const ids = { ...as };
  const swap = (text: string) => text.replace(/\be_[a-z0-9]{8}\b|\b[a-z][a-z0-9_]*\.[a-z0-9_]+\b/g, (word) => ids[word] ?? word);
  for (const type of Object.keys(KEEP)) {
    const these = [...items].filter(([, i]) => i.type === type);
    if (!these.length) continue;
    const keep = KEEP[type];
    const ops: Ops = these.map(([id, i]) => ({ op: 'create', ref: id, type, title: i.title, ...(i.body && { body: i.body }), props: JSON.parse(swap(JSON.stringify(keep ? Object.fromEntries(Object.entries(i.props).filter(([k]) => keep.includes(k))) : i.props))) }));
    Object.assign(ids, await made_(to, actor, `The ${type === 'lens' ? 'views' : `${type}s`} of a shared map`, ops));
  }
}
