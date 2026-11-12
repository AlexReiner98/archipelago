// A held change taken back by whoever proposed it (bump e_6w7pcdwg). It is not a decision: nobody approves or
// declines it, it leaves the queue as withdrawn, with an entry of no facts that says so, as a moot one leaves as
// superseded. Only the change's own proposer may, and only while it is pending: another's held change is the owner's
// to decide. A newer held change that sets every field an older one of the same proposer sets says it covers it.

import type { Actor, Archipelago, Op, Proposal } from './pelago.ts';
import { proposalsOf, rejection } from './proposals.ts';

const SET = ['title', 'status', 'owner', 'visibility', 'confidence'] as const;

/** What an op settles, as keys: an item's field, a link, an archive. Undefined for one that makes something new. */
function settles(op: Op): string[] | undefined {
  if (op.op === 'update') {
    const keys = SET.filter((f) => op[f] !== undefined).map((f) => `${op.id}.${f}`);
    if (op.body !== undefined || op.append !== undefined || op.replace) keys.push(`${op.id}.body`);
    keys.push(...Object.keys(op.props ?? {}).map((k) => `${op.id}.props.${k}`));
    return keys;
  }
  if (op.op === 'link') return [`link ${op.type} ${op.from} ${op.to}`];
  if (op.op === 'unlink') return [`unlink ${op.relation}`];
  if (op.op === 'archive' || op.op === 'restore') return [`${op.op} ${op.id}`];
  return undefined;
}

const keysOf = (p: Pick<Proposal, 'ops'>) => {
  const all = p.ops.map(settles);
  return all.some((k) => k === undefined) ? undefined : new Set(all.flat() as string[]);
};

/**
 * Of pending held changes, which older ones each newer one covers: proposed by the same actor, earlier, and asking
 * for nothing the newer one does not set again. One that makes something new is never covered: what it makes is its own.
 */
export function covering(pending: Pick<Proposal, 'id' | 'ts' | 'actor' | 'ops'>[]): Map<string, string[]> {
  const keys = new Map(pending.map((p) => [p.id, keysOf(p)]));
  const covers = new Map<string, string[]>();
  for (const newer of pending) {
    const mine = keys.get(newer.id);
    if (!mine) continue;
    const older = pending.filter((p) => {
      const theirs = keys.get(p.id);
      return p.id !== newer.id && p.actor === newer.actor && new Date(p.ts) < new Date(newer.ts) && theirs?.size && [...theirs].every((k) => mine.has(k));
    });
    if (older.length) covers.set(newer.id, older.map((p) => p.id));
  }
  return covers;
}

/** Each pending held change with what it covers and what covers it, as the queue is read. */
export function withCovers<P extends Pick<Proposal, 'id' | 'ts' | 'actor' | 'ops'>>(pending: P[]): (P & { covers?: string[]; covered_by?: string[] })[] {
  const covers = covering(pending);
  const by = new Map<string, string[]>();
  for (const [newer, older] of covers) for (const id of older) by.set(id, [...(by.get(id) ?? []), newer]);
  return pending.map((p) => ({ ...p, ...(covers.has(p.id) && { covers: covers.get(p.id) }), ...(by.has(p.id) && { covered_by: by.get(p.id) }) }));
}

/** Take back a held change `actor` proposed. Never another's, and never one already decided. */
export async function withdraw(l: Archipelago, actor: Actor, input: { proposal: string; reason?: string }) {
  const me = `${actor.kind}:${actor.name}`;
  const { rows } = await l.db.query<Proposal>(`select * from proposal where id = $1`, [input.proposal]);
  const p = rows[0];
  if (!p) throw new Error(`No proposal "${input.proposal}"`);
  if (p.actor !== me) throw new Error(`Proposal ${p.id} was made by ${p.actor}, not you: only its proposer may withdraw it, and deciding it is a person's.`);
  if (p.status !== 'pending') throw new Error(`Proposal ${p.id} is already ${p.status}`);
  const by = [...covering(await proposalsOf(l))].find(([, older]) => older.includes(p.id))?.[0];
  const note = input.reason ?? (by ? `Covered by ${by}` : 'Withdrawn by its proposer');
  const done = await l.db.transaction((tx) => rejection(tx, l.workspace, p.id, { outcome: 'withdrawn', actor: me, by: me, reason: p.reason, note }));
  if (!done) throw new Error(`Proposal ${p.id} was decided first`);
  return { proposal: p.id, status: 'withdrawn', note };
}
