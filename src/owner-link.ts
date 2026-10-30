// An item's owner is a link (owned_by, core's), as every tie between two things on the map is (the owner, 30 Oct
// 2026). The row's owner column stays as the link's index, for row-level reads and for attention: the write path
// keeps the two the same, and an item has one owner, so a new owned_by link takes the place of the one before it.

import { linkFacts } from './facts.ts';
import type { Q } from './db.ts';
import type { Fact } from './log.ts';
import type { Archipelago, Op } from './pelago.ts';

export const OWNED_BY = 'owned_by';

/** The item an op says the owner of, and who it says, where it says one. */
async function said(tx: Q, op: Op, resolve: (key: string) => string, made: string): Promise<{ item: string; owner: string | null } | null> {
  if (op.op === 'create') return op.owner ? { item: made, owner: resolve(op.owner) } : null;
  if (op.op === 'update') return op.owner === undefined ? null : { item: op.id, owner: op.owner && resolve(op.owner) };
  if (op.op === 'link') return op.type === OWNED_BY ? { item: resolve(op.from), owner: resolve(op.to) } : null;
  if (op.op === 'unlink') {
    const { rows } = await tx.query<{ type: string; from_id: string }>(`select type, from_id from relation where id = $1`, [op.relation]);
    return rows[0]?.type === OWNED_BY ? { item: rows[0].from_id, owner: null } : null;
  }
  if (op.op !== 'merge') return null;
  // Two owners merged: the item kept keeps its own, and takes the other's where it had none.
  const { rows } = await tx.query<{ owner: string | null; to_id: string | null }>(
    `select e.owner, r.to_id from entity e left join relation r on r.from_id = e.id and r.type = $2 and r.valid_to is null where e.id = $1 limit 1`, [op.keep, OWNED_BY]);
  return { item: op.keep, owner: rows[0]?.owner ?? rows[0]?.to_id ?? null };
}

/** What an op, once applied, leaves to say so that the item's owner link and its column agree. */
export async function ownerFollows(tx: Q, op: Op, resolve: (key: string) => string, made: string, mint: () => string): Promise<Fact[]> {
  const it = await said(tx, op, resolve, made);
  if (!it) return [];
  const { rows: links } = await tx.query<{ id: string; to_id: string }>(`select id, to_id from relation where from_id = $1 and type = $2 and valid_to is null`, [it.item, OWNED_BY]);
  const { rows: [row] } = await tx.query<{ owner: string | null }>(`select owner from entity where id = $1`, [it.item]);
  const facts: Fact[] = links.filter((l) => l.to_id !== it.owner).map((l) => ['-', l.id, 'link']);
  if (it.owner && !links.some((l) => l.to_id === it.owner)) facts.push(...linkFacts({ id: mint(), type: OWNED_BY, from_id: it.item, to_id: it.owner, props: {}, confidence: 1, source_id: null }));
  if ((row?.owner ?? null) !== it.owner) facts.push(it.owner ? ['+', it.item, 'owner', it.owner] : ['-', it.item, 'owner']);
  return facts;
}

/** Each owner said before owned_by existed, said as the link (a migration, run once): the log keeps what it said. */
export async function linkOwners(l: Archipelago, id: () => string): Promise<number> {
  const { rows } = await l.db.query<{ id: string; owner: string }>(
    `select e.id, e.owner from entity e where e.owner is not null and not exists (select 1 from relation r where r.from_id = e.id and r.type = $1 and r.valid_to is null) -- index entity_owner`, [OWNED_BY]);
  if (!rows.length) return 0;
  const facts = rows.flatMap((e) => linkFacts({ id: id(), type: OWNED_BY, from_id: e.id, to_id: e.owner, props: {}, confidence: 1, source_id: null }));
  await l.db.transaction((tx) => l.moved(tx, 'owner.linked', 'Each owner, said as a link', facts));
  return rows.length;
}
