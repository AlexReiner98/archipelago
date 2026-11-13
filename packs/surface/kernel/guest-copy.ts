// Make it yours: a guest map that starts as a copy of a shared map (the owner, 13 Nov 2026, e_8yd7wh5r). What is
// copied is what the public view shows anyone, read through the same function a reader's page is (./public-views.ts),
// so nothing private can come with it: its items, each as its type, title, status and the words shown of it, and the
// links between them, part_of included. The views themselves stay behind; the guest's map draws what came.

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { publicView } from './public-views.ts';

type Shown = { id: string; type: string; title: string; status?: string | null; body?: string; gist?: string; inside?: string | null };
type Frozen = { title?: string; parts?: { section?: Shown }[]; lenses?: Record<string, { items?: Shown[]; links?: { from: string; to: string; type: string }[] }> };

/** Where a shared map is: /p/<workspace>/<id>, or that address whole. */
export function sharedAt(from: unknown): { workspace: string; id: string } | undefined {
  const at = typeof from === 'string' ? /\/p\/([a-z0-9][a-z0-9-]{0,62})\/(e_[a-z0-9]{8})\/?$/.exec(from) : null;
  return at ? { workspace: at[1], id: at[2] } : undefined;
}

/** Copy what a public view shows into `to`, at most `most` items, as one change made as `actor`. The number copied. */
export async function copyShared(from: Archipelago, id: string, to: Archipelago, actor: Actor, most: number): Promise<number> {
  const doc = (await publicView(from, id)) as Frozen | null;
  if (!doc) throw new Error('Nothing is shared at that address.');
  const reg = to.registry, system = new Set(reg.family('system'));
  const items = new Map<string, Shown>();
  const links: { from: string; to: string; type: string }[] = [];
  // The item shared is the first, and a document's sections are part of it.
  const root: Shown = { id, type: String((doc as { type?: unknown }).type ?? 'work'), title: doc.title ?? 'Shared map', status: (doc as { status?: string }).status };
  items.set(id, root);
  for (const part of doc.parts ?? []) if (part.section && part.section.id !== id) {
    items.set(part.section.id, part.section);
    links.push({ from: part.section.id, to: id, type: 'part_of' });
  }
  for (const lens of Object.values(doc.lenses ?? {})) {
    for (const item of lens.items ?? []) {
      if (!items.has(item.id)) items.set(item.id, item);
      if (item.inside) links.push({ from: item.id, to: item.inside, type: 'part_of' });
    }
    links.push(...(lens.links ?? []));
  }
  // What is drawn is copied; the views, layouts and other workings of the map that shared it are not.
  const kept = [...items.values()].filter((i) => !system.has(i.type)).slice(0, most);
  const ids = new Set(kept.map((i) => i.id));
  const ops: Record<string, unknown>[] = kept.map((i) => {
    const type = reg.type(i.type) ? i.type : 'work'; // a type of a pack this map lacks comes as work
    const statuses = reg.type(type)?.statuses;
    const status = i.status && type === i.type && statuses && [...statuses.open, ...statuses.closed].includes(i.status) ? i.status : undefined;
    const body = (i.body ?? i.gist ?? '').trim();
    return { op: 'create', ref: i.id, type, title: i.title.slice(0, 60), ...(body && { body }), ...(status && { status }) };
  });
  const seen = new Set<string>();
  for (const k of links) {
    const key = `${k.type} ${k.from} ${k.to}`;
    if (!ids.has(k.from) || !ids.has(k.to) || k.from === k.to || seen.has(key) || !reg.relations.has(k.type)) continue;
    seen.add(key);
    ops.push({ op: 'link', type: k.type, from: k.from, to: k.to });
  }
  if (!kept.length) return 0;
  await to.change(actor, { reason: `Made from "${doc.title ?? 'a shared map'}"`, ops } as never);
  return kept.length;
}
