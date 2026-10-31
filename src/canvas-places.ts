// Where a person put things on a canvas (decision e_n2825x2w): a compacted stream of its own, `places`, one value per
// canvas and item, the middle of the item as [x, y] in the picture's own units. Never an item or a link: the problem's
// graph holds no layout. Each place is a fact on the item, under the field `place:<canvas>`, so compaction keeps the
// newest per canvas and item (core's retention rule `places`), the item's key seals it, and a member reads only the
// places of what they may see (log_op's row security reads the item named). A canvas is, for now, what the page draws
// from: an item's id, or the workspace's for the whole map.

import type { Q } from './db.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { readOps, type OpFact } from './streams.ts';

export type Place = [number, number];

/** The field a canvas's places are kept under, on each item placed. */
export const placeField = (canvas: string) => `place:${canvas}`;

const ITEM = /^e_[a-z0-9]{8}$/, FORM = /^[a-z]+$/;
const isPlace = (v: unknown): v is Place => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * A canvas this workspace has: the workspace itself (the whole map, also when none is named), or an item the reader may
 * see. After an @, the form it is drawn in: a place means something only in the picture it was put on, and a form that
 * lays out another way keeps its own.
 */
async function canvasOf(l: Archipelago, canvas: string | undefined): Promise<string> {
  const [named, form] = (canvas ?? '').split('@'), kept = form && FORM.test(form) ? `@${form}` : '';
  if (form !== undefined && !kept) throw new Error(`No form "${form}" on a canvas.`);
  if (!named || named === l.workspace) return `${l.workspace}${kept}`;
  if (!ITEM.test(named) || !(await l.entity(named))) throw new Error(`No canvas "${canvas}": a canvas is an item's id, or "${l.workspace}" for the whole map.`);
  return `${named}${kept}`;
}

/** Where each item stands on a canvas, by item: the newest place of each, as the reader may see them. */
export async function placesOn(l: Archipelago, canvas: string | undefined): Promise<Record<string, Place>> {
  return placesUnder(l.db, placeField(await canvasOf(l, canvas)));
}

/** The newest place of each item under one canvas's field, read in the transaction given. */
async function placesUnder(q: Q, field: string): Promise<Record<string, Place>> {
  const out: Record<string, Place> = {};
  for (const e of await readOps(q, 'places', { field }))
    for (const f of e.facts) {
      if (f[2] !== field) continue;
      if (f[0] === '+' && isPlace(f[3])) out[f[1]] = f[3];
      else delete out[f[1]];
    }
  return out;
}

/**
 * Write a batch of moves on one canvas at once, in one transaction: each item's new place, or null to forget it; with
 * `clear`, every place on the canvas is forgotten first (laid out again). Each fact is an entry of its own, so a member
 * who may not see one item still reads the places of the rest. Returns how many were put and forgotten.
 */
export async function putPlaces(l: Archipelago, actor: Actor, input: { canvas?: string; moves?: Record<string, Place | null>; clear?: boolean }) {
  const canvas = await canvasOf(l, input.canvas);
  const field = placeField(canvas);
  const moves = Object.entries(input.moves ?? {});
  const wrong = moves.filter(([id, at]) => !ITEM.test(id) || (at !== null && !isPlace(at))).map(([id]) => id);
  if (wrong.length) throw new Error(`A move is an item's id and its place as [x, y], or null to forget it: not ${wrong.slice(0, 3).join(', ')}.`);
  const { rows } = moves.length ? await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[])`, [moves.map(([id]) => id)]) : { rows: [] };
  const seen = new Set(rows.map((r) => r.id));
  const missing = moves.filter(([id]) => !seen.has(id)).map(([id]) => id);
  if (missing.length) throw new Error(`No item ${missing.slice(0, 3).join(', ')}.`);
  return l.db.transaction(async (tx) => {
    const was = await placesUnder(tx, field);
    const facts = new Map<string, OpFact>();
    if (input.clear) for (const id of Object.keys(was)) facts.set(id, ['-', id, field]);
    for (const [id, at] of moves) {
      if (at === null) (was[id] || facts.has(id)) && facts.set(id, ['-', id, field]);
      else facts.set(id, ['+', id, field, [Math.round(at[0]), Math.round(at[1])]]);
    }
    for (const f of facts.values()) await l.record('places', actorId(actor), [f], undefined, tx);
    const put = [...facts.values()].filter((f) => f[0] === '+').length;
    return { canvas, put, forgotten: facts.size - put };
  });
}

/**
 * A migration, run when a workspace opens: a style that kept places as a field (the 'Canvas places' blob, before this
 * stream) has them moved into the stream, and is retired with the field taken off it. Its canvases were keyed by the
 * item a view was drawn from, or "map" for the whole map; any other key (a view's own) is not a canvas now, and goes.
 * Returns how many places moved.
 */
export async function movePlaces(l: Archipelago): Promise<number> {
  const { rows } = await l.db.query<{ id: string; places: Record<string, Record<string, unknown>> }>(
    `select id, props->'places' as places from entity where type = 'style' and props ? 'places' and archived_at is null -- index entity_type`,
  );
  let n = 0;
  for (const blob of rows) {
    const facts: OpFact[] = [];
    for (const [key, of] of Object.entries(blob.places ?? {})) {
      const canvas = key === 'map' ? l.workspace : ITEM.test(key) ? key : null;
      if (!canvas || !of || typeof of !== 'object') continue;
      for (const [id, at] of Object.entries(of)) if (ITEM.test(id) && isPlace(at)) facts.push(['+', id, placeField(canvas), [Math.round(at[0]), Math.round(at[1])]]);
    }
    await l.db.transaction(async (tx) => {
      for (const f of facts) await l.record('places', 'system', [f], undefined, tx);
      await l.moved(tx, 'places.moved', 'Places moved into their own stream; the style that kept them retired', [['+', blob.id, 'status', 'retired'], ['-', blob.id, 'places']]);
    });
    n += facts.length;
  }
  return n;
}
