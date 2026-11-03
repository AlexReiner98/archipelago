// An item settled or closed on a person's word no longer waits on them: the change that closes it also takes back its
// waits_on to that person (bump e_2y6wwjkn), and its answer says so. Whose word it is: the
// person acting, or the one an agent's token works for when it says it acts on a human's word.

import type { Q } from './db.ts';
import type { Fact } from './log.ts';
import type { Registry } from './packs.ts';
import type { Authority, Op } from './pelago-types.ts';
import type { Archipelago } from './pelago.ts';

/** A waits_on taken back because what it waited for was answered. */
export interface Unwaited { item: string; person: string; relation: string }

/** The person whose word a change is, where it is a person's: the one the map is read as, or the workspace's owner. */
export async function whoseWord(map: Archipelago, authority: Authority | null | undefined): Promise<string | null> {
  return authority?.of !== 'human' ? null : map.viewer || (await map.setting<string>('me')) || null;
}

/** The live waits_on links from these items to this person. */
export async function waitsOn(q: Q, reg: Registry, items: string[], person: string): Promise<{ id: string; from_id: string }[]> {
  if (!items.length) return [];
  const { rows } = await q.query<{ id: string; from_id: string }>(
    `select id, from_id from relation where from_id = any($1::text[]) and to_id = $2 and type = any($3::text[]) and valid_to is null`,
    [items, person, reg.relationFamily('waits_on')],
  );
  return rows;
}

/**
 * What an op leaves to say once applied: an update that moves an item to one of its type's closed statuses, on a
 * person's word, unlinks the item's waits_on to that person, unless the change unlinks it itself. Each one taken back
 * is added to gone, for the answer.
 */
export async function unwaitFollows(tx: Q, reg: Registry, op: Op, person: string | null, gone: Unwaited[], ops: Op[] = []): Promise<Fact[]> {
  if (!person || op.op !== 'update' || !op.status) return [];
  const { rows: [item] } = await tx.query<{ type: string }>(`select type from entity where id = $1`, [op.id]);
  if (!item || !reg.type(item.type)?.statuses.closed.includes(op.status)) return [];
  const said = new Set(ops.flatMap((o) => (o.op === 'unlink' ? [o.relation] : [])));
  const links = (await waitsOn(tx, reg, [op.id], person)).filter((l) => !said.has(l.id));
  gone.push(...links.map((l) => ({ item: op.id, person, relation: l.id })));
  return links.map((l): Fact => ['-', l.id, 'link']);
}
