// A change sent with a key (its `key`) applies once. The key names the ids the change would take: the change set it
// appends when it applies, the proposal when it is held. Sent again with the same key (a retry after a 502, or a
// restart that cut the first answer off), the log already has an entry under one of those ids, and the first change
// is answered instead of a second one applied. The log is the record of it, so nothing else keeps the keys: a key
// is good for as long as the log keeps its entry.

import { createHash } from 'node:crypto';
import type { Q } from '../../database/kernel/db.ts';

/** The longest key taken: a request id, a uuid, a few words. */
export const KEY_MAX = 200;

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** An id of the shape newId makes (src/ids.ts), drawn from a seed instead of chance: the same seed, the same id. */
function idFrom(prefix: string, seed: string): string {
  let out = '';
  for (const byte of createHash('sha256').update(seed).digest().subarray(0, 8)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** The ids a keyed change takes, by who sent it and its key: another sender's same key is another change. */
export function keyedIds(who: string, key: string): { changeset: string; proposal: string } {
  const seed = `${who}\u0000${key}`;
  return { changeset: idFrom('c', seed), proposal: idFrom('p', seed) };
}

/** The first answer to a keyed change sent again: where it went, or undefined while nothing was appended under its ids. */
export async function firstAnswer(db: Q, ids: { changeset: string; proposal: string }): Promise<Record<string, unknown> | undefined> {
  // By its id alone: the read names one entry (log_entry_id).
  const { rows } = await db.query<{ id: string; at: Date; reason: string | null }>(
    `select id, at, head ->> 'reason' as reason from log_entry where id = any($1::text[]) limit 1 -- index log_entry_id`,
    [[ids.changeset, ids.proposal]],
  );
  const first = rows[0];
  if (!first) return undefined;
  const at = new Date(first.at).toISOString();
  if (first.id === ids.changeset)
    return { status: 'applied', changeset: first.id, again: true, applied_at: at, note: `Applied once already, at ${at}, under this key: nothing was applied again. undo with changeset ${first.id} takes it back.` };
  const { rows: held } = await db.query<{ status: string }>(`select status from proposal where id = $1`, [first.id]);
  const now = held[0]?.status ?? 'pending';
  return { status: 'proposed', proposal: first.id, again: true, held_at: at, proposal_status: now, note: `Held once already, at ${at}, under this key, and ${now} now: nothing was held again.` };
}

/** Thrown inside the transaction when the same keyed change was appended while this one was planned. */
export class AppliedAlready extends Error {
  constructor() { super('A change under this key was appended while this one was planned.'); }
}

/**
 * In the transaction that appends a keyed change: one of the same key at a time, and none once one is in the log.
 * The lock lasts to the commit, so a second sent at once waits for the first and then finds it.
 */
export async function onceUnder(tx: Q, ids: { changeset: string; proposal: string }): Promise<void> {
  await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.key'), hashtext($1))`, [ids.changeset]);
  const { rows } = await tx.query(`select 1 from log_entry where id = any($1::text[]) limit 1 -- index log_entry_id`, [[ids.changeset, ids.proposal]]);
  if (rows.length) throw new AppliedAlready();
}
