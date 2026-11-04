// What closing an item leaves open that it was meant to close. A link type may say that closing the item it runs
// from offers to close the one it runs to (`offers_close`, as core's addresses does): a task done leaves the issues it
// addresses open, for whoever closed it to say whether each is fixed. The kernel closes none of them itself: work that
// addresses an issue may only reduce it. It names them in the answer, each with the op that closes it, ready to send,
// and names them in the line a commit closes its item by.

import type { Q } from './db.ts';
import type { Registry } from './packs.ts';

export interface Offer {
  id: string;
  title: string;
  status: string;
  /** What closed it: the item the link runs from. */
  by: string;
  link: string;
  /** The op that closes it, as change takes it. */
  op: { op: 'update'; id: string; status: string };
}

/** The link types whose target closing their source offers to close. */
export const offering = (reg: Registry): string[] => [...reg.relations.values()].filter((r) => r.offers_close && !r.dormant).map((r) => r.id);

/** What is still open that these items run an offering link to, other than what is in `besides`. */
export async function openTargets(db: Q, reg: Registry, from: string[], besides: Set<string> = new Set()): Promise<Offer[]> {
  const types = offering(reg);
  if (!from.length || !types.length) return [];
  const { rows } = await db.query<{ id: string; title: string; status: string; type: string; by: string; link: string }>(
    `select e.id, e.title, e.status, e.type, r.from_id as by, r.type as link from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and e.is_open and e.archived_at is null order by e.id`,
    [from, types],
  );
  const seen = new Set<string>();
  const offers: Offer[] = [];
  for (const r of rows) {
    const status = reg.type(r.type)?.statuses.closed[0];
    if (!status || besides.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    offers.push({ id: r.id, title: r.title, status: r.status, by: r.by, link: r.link, op: { op: 'update', id: r.id, status } });
  }
  return offers;
}

type Op = { op: string; id?: string; status?: string };

/** What a change closes: the ids of its updates that set a closed status of their item's type, as their items are now. */
export async function closedBy(db: Q, reg: Registry, ops: Op[]): Promise<string[]> {
  const asked = ops.filter((o) => o.op === 'update' && o.id && o.status);
  if (!asked.length) return [];
  const { rows } = await db.query<{ id: string; type: string }>(`select id, type from entity where id = any($1::text[])`, [asked.map((o) => o.id!)]);
  const typeOf = new Map(rows.map((r) => [r.id, r.type]));
  return [...new Set(asked.filter((o) => typeOf.has(o.id!) && reg.type(typeOf.get(o.id!)!)?.statuses.closed.includes(o.status!)).map((o) => o.id!))];
}

/**
 * What a change that closes items leaves open that they were meant to close, as its answer says it: each item with
 * the op that closes it. Undefined when it leaves nothing. What the same change sets a status of is left out: its
 * sender has said already.
 */
export async function closeOffers(db: Q, reg: Registry, ops: Op[]): Promise<{ say: string; items: Pick<Offer, 'id' | 'title' | 'status' | 'by'>[]; ops: Offer['op'][] } | undefined> {
  const closed = await closedBy(db, reg, ops);
  const touched = new Set(ops.filter((o) => o.op === 'update' && o.id && o.status).map((o) => o.id!));
  const items = await openTargets(db, reg, closed, touched);
  if (!items.length) return undefined;
  return {
    say: `What this closes was meant to fix ${items.length === 1 ? 'an item' : `${items.length} items`} still open: send the ops of those it fixed in a change, and leave open what it did not.`,
    items: items.map(({ id, title, status, by }) => ({ id, title, status, by })),
    ops: items.map((i) => i.op),
  };
}
