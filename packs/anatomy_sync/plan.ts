// What a sync sends: the ops that bring the island from what it holds to what the extractors want, within the scope of
// this run. A full run speaks for every kind of key; a run on a change speaks only for the keys its files make, may
// archive only what its files no longer declare, and follows a moved file (git's rename) by changing the path of the
// same item, so it keeps its history and its links. Pure: the island as read and the model in, ops out; the script and
// the handler send them.

import { MADE_LINKS, type Model, type Want } from './model.ts';

/** An item of the island as read, with its fields and its note whole (or cut by the query, ending in an ellipsis). */
export interface Held { id: string; type: string; title: string; body: string; props: Record<string, any> }
/** The island as read: its items by key, and the links among them. */
export interface Island { island: string; byKey: Map<string, Held>; keyById: Map<string, string>; links: { id: string; type: string; from: string; to: string }[] }
/** What this run may change beyond making and changing what it wants: what it may archive, and the files that moved. */
export interface Scope { mayArchive: (key: string) => boolean; renames?: [from: string, to: string][] }
export type Op = Record<string, unknown>;

/** A note the query cut ends in an ellipsis: it is the same when the whole one starts with what was kept. */
export const sameNote = (w: string, h: string) => w === h || (h.endsWith('…') && w.startsWith(h.slice(0, -1).trimEnd()));
const same = (w: Want, h: Held) => w.title === h.title && sameNote(w.body || '', h.body || '') && Object.entries(w.props).every(([k, v]) => h.props?.[k] === v);
const linkKey = (l: { type: string; from: string; to: string }) => `${l.type}|${l.from}|${l.to}`;

/**
 * The ops, in the order they are sent: makes (each with a ref `r<n>`, which later ops name), renames and changes,
 * archives, ties and take-backs. A link of the sync's own types is taken back only from an item this run speaks for.
 */
export function plan(want: Model, island: Island, scope: Scope): { ops: Op[]; counts: Record<string, number> } {
  const byKey = new Map(island.byKey);
  const ops: Op[] = [];
  let renamed = 0;
  for (const [from, to] of scope.renames ?? []) {
    const held = byKey.get(from);
    if (!held || byKey.has(to)) continue;
    const path = to.slice(to.indexOf(':') + 1);
    ops.push({ op: 'update', id: held.id, props: { path } });
    byKey.delete(from); byKey.set(to, { ...held, props: { ...held.props, path } }); renamed++;
  }
  const keyById = new Map([...byKey].map(([k, h]) => [h.id, k]));
  const id = (key: string) => byKey.get(key)?.id;
  const wanted = new Set(want.items.map((w) => w.key));
  const create = want.items.filter((w) => !id(w.key));
  const refs = new Map(create.map((w, j) => [w.key, `r${j}`]));
  const end = (key: string) => id(key) ?? refs.get(key) ?? key;
  const update = want.items.filter((w) => id(w.key) && !same(w, byKey.get(w.key)!));
  const gone = [...byKey].filter(([k]) => !wanted.has(k) && scope.mayArchive(k));
  const wantedLinks = new Map(want.links.map((l) => [linkKey({ type: l.type, from: end(l.from), to: end(l.to) }), l] as const));
  const held = new Set(island.links.map(linkKey));
  const tie = [...wantedLinks].filter(([k]) => !held.has(k)).map(([, l]) => l);
  const untie = island.links.filter((l) => MADE_LINKS.includes(l.type) && wanted.has(keyById.get(l.from) ?? '') && keyById.has(l.to) && !wantedLinks.has(linkKey(l)));
  ops.unshift(...create.map((w) => ({ op: 'create', ref: refs.get(w.key), type: w.type, title: w.title, ...(w.body && { body: w.body }), props: { island: island.island, ...w.props } })));
  ops.push(
    ...update.map((w) => ({ op: 'update', id: id(w.key), title: w.title, body: w.body, props: w.props })),
    ...gone.map(([, h]) => ({ op: 'archive', id: h.id })),
    ...tie.map((l) => ({ op: 'link', type: l.type, from: end(l.from), to: end(l.to), ...(l.props && { props: l.props }) })),
    ...untie.map((l) => ({ op: 'unlink', relation: l.id })),
  );
  return { ops, counts: { make: create.length, rename: renamed, change: update.length, archive: gone.length, tie: tie.length, untie: untie.length } };
}
