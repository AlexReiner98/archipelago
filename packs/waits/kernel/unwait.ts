// An item settled or closed on a person's word no longer waits on them: the change that closes it also takes back its
// waits_on to that person (bump e_2y6wwjkn), and its answer says so. Whose word it is: the person acting, or the one
// an agent's token works for when it says it acts on a human's word.
//
// Moved from src/unwait.ts into the waits pack (task e_mhqvdzj6). What it follows an op with is still said at the
// level of facts, inside the apply loop's transaction, which the write path hands it (`q`): as a write.follow its ops
// would be judged by the rules, which is the owner's to choose, so it keeps its place there until they do.

import type { KernelContext } from '#pelago/kernel';

/** A waits_on taken back because what it waited for was answered. */
export interface Unwaited { item: string; person: string; relation: string }

/** What the write path hands: a query on the change's transaction, or on the map. */
export interface Q { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
/** The registry a change is judged by, as this reads it. */
export interface Reg { relationFamily(...roots: string[]): string[]; type(id: string): { statuses: { closed: string[] } } | undefined }
/** The ops it reads: a status set, a link taken back. */
export type Op = { op: string; id?: string; status?: string; relation?: string };
/** A link's end, said as a fact. */
export type Unlinked = ['-', string, string];

/** The person whose word a change is, where it is a person's: the one the map is read as, or the workspace's owner. */
export async function whoseWord(ctx: KernelContext, authority: { of: string } | null | undefined): Promise<string | null> {
  return authority?.of !== 'human' ? null : ((await ctx.reads({ me: true })) as string | null) || null;
}

/** The live waits_on links from these items to this person. */
export async function waitsOn(q: Q, reg: Reg, items: string[], person: string): Promise<{ id: string; from_id: string }[]> {
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
export async function unwaitFollows(tx: Q, reg: Reg, op: Op, person: string | null, gone: Unwaited[], ops: Op[] = []): Promise<Unlinked[]> {
  if (!person || op.op !== 'update' || !op.status || !op.id) return [];
  const id = op.id;
  const { rows: [item] } = await tx.query<{ type: string }>(`select type from entity where id = $1`, [id]);
  if (!item || !reg.type(item.type)?.statuses.closed.includes(op.status)) return [];
  const said = new Set(ops.flatMap((o) => (o.op === 'unlink' && o.relation ? [o.relation] : [])));
  const links = (await waitsOn(tx, reg, [id], person)).filter((l) => !said.has(l.id));
  gone.push(...links.map((l) => ({ item: id, person, relation: l.id })));
  return links.map((l): Unlinked => ['-', l.id, 'link']);
}
