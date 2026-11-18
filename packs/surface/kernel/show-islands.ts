// A show of islands puts them on the person's canvas at once (the owner, 18 Nov 2026, bump e_wpybzm42): the islands the
// show names, and the island of the item it opens, join the list kept on their person item (core's field `islands`), as
// a change through the one write path, so they are there whenever the person next looks, with or without a page open.
// A person who has never chosen a list sees the map's islands, the newest first, already: their list is left unmade.

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';

const ISLAND = /^e_[a-z0-9]{8}$/;

/** The islands a show's address names: those in `islands=`, and the item's own island, given as `island`. */
export function shownIslands(hash: string, island?: unknown): string[] {
  const named = new URLSearchParams(hash.split('?')[1] ?? '').get('islands')?.split(',') ?? [];
  return [...new Set([...named, ...(typeof island === 'string' ? [island] : [])])].filter((id) => ISLAND.test(id));
}

/** The list with these islands added after it, or null where none is new. */
export function withIslands(list: unknown[], adding: string[]): unknown[] | null {
  const fresh = adding.filter((id) => !list.includes(id));
  return fresh.length ? [...list, ...fresh] : null;
}

/** Put the islands a show names on the person's canvas: the ids added, none where nothing was new or there is no person. */
export async function putShownOn(l: Archipelago, actor: Actor, hash: string, island?: unknown, run?: string): Promise<string[]> {
  const adding = shownIslands(hash, island);
  if (!adding.length) return [];
  const person = l.viewer || (await l.setting<string>('me'));
  const kept = person ? (await l.entity(person))?.props.islands : undefined;
  if (!person || !Array.isArray(kept)) return [];
  const next = withIslands(kept, adding);
  if (!next) return [];
  const added = next.slice(kept.length) as string[];
  await l.change(actor, {
    reason: `Shown, so put on the canvas: ${added.join(', ')}`,
    ops: [{ op: 'update', id: person, props: { islands: next } }],
    authority: { of: 'agent', basis: 'A show of islands puts them on the person’s canvas (the owner, 18 Nov 2026, e_wpybzm42)' },
    ...(run && { run }),
  });
  return added;
}
