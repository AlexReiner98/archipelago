// The compacted streams sealed as the fact stream is (docs/log.md, section 5). A fact's value about an item or a link
// is sealed with that item's key, what is structure (CLEAR in src/seal.ts) stays clear; an entry's reason is sealed with
// the key of the first item it names, or with its stream's own key when it names none, so a forget takes an
// operational entry's words with its item. A segment is hashed with each sealed value as its digest, so its hash
// verifies with no key and still does once a forget has put the digest in the value's place.

import type { Q } from './db.ts';
import { digestOf, isSealed, open, seal, sealable } from './seal.ts';
import { keysFor, keysOf } from './vault.ts';
import type { Light, OpFact } from './streams.ts';

type Head = { reason?: unknown; [field: string]: unknown };

/** The id whose key seals an entry's reason. */
export const reasonKey = (stream: string, facts: OpFact[]) => facts.find((f) => f[1].startsWith('e_') || f[1].startsWith('r_'))?.[1] ?? `op:${stream}`;

const field = (name: string) => `log_op.${name}`;

/** An entry's header and facts as log_op stores them. Run in the transaction that appends it: missing keys are made there. */
export async function sealOp<H extends Head>(q: Q, ws: string, stream: string, head: H, facts: OpFact[]): Promise<{ head: H; facts: OpFact[] }> {
  const ids = new Set(facts.filter((f) => f[0] === '+' && sealable(f[1], f[2])).map((f) => f[1]));
  const said = head.reason !== undefined && head.reason !== null;
  if (said) ids.add(reasonKey(stream, facts));
  if (!ids.size) return { head, facts };
  const ring = await keysFor(q, ws, [...ids]);
  return {
    head: said ? { ...head, reason: seal(ring.get(reasonKey(stream, facts))!, field('reason'), head.reason) } : head,
    facts: facts.map((f): OpFact => (f[0] === '+' && sealable(f[1], f[2]) ? ['+', f[1], f[2], seal(ring.get(f[1])!, field(f[2]), f[3])] : f)),
  };
}

/**
 * Entries as their reader reads them: each sealed value opened with the key of what it is about, or left as its
 * digest when that key is gone. Which entries a member may read at all is the database's (log_op's row security).
 */
export async function openOps(q: Q, entries: Light[]): Promise<Light[]> {
  const ids = new Set<string>();
  for (const e of entries) {
    for (const f of e.facts) if (f[0] === '+' && isSealed(f[3])) ids.add(f[1]);
    if (isSealed(e.reason)) ids.add(reasonKey(e.stream, e.facts));
  }
  if (!ids.size) return entries;
  const ring = await keysOf(q, [...ids]);
  const read = (id: string, name: string, v: unknown) => (isSealed(v) ? (open(ring.get(id), field(name), v) ?? digestOf(v)) : v);
  return entries.map((e) => ({
    ...e,
    facts: e.facts.map((f): OpFact => (f[0] === '+' ? ['+', f[1], f[2], read(f[1], f[2], f[3])] : f)),
    ...(e.reason !== undefined && { reason: read(reasonKey(e.stream, e.facts), 'reason', e.reason) as string }),
  }));
}

/** An entry as a segment hashes it: each sealed value as its digest. */
export const hashed = (e: Light): Light => ({
  ...e,
  facts: e.facts.map((f): OpFact => (f[0] === '+' && isSealed(f[3]) ? ['+', f[1], f[2], digestOf(f[3])] : f)),
  ...(isSealed(e.reason) && { reason: digestOf(e.reason) as unknown as string }),
});

/**
 * Run as the compaction role, the one log_op lets change a row, and back to the role the transaction had. A forget's
 * transaction may have dropped to a member's, who cannot see every entry.
 */
export async function asCompactor<T>(tx: Q, fn: () => Promise<T>): Promise<T> {
  const { rows } = await tx.query<{ role: string }>(`select current_setting('role') as role`);
  await tx.query(`set local role pelago_compactor`);
  try {
    return await fn();
  } finally {
    await tx.query(`select set_config('role', $1, true)`, [rows[0].role]);
  }
}

/** Every link a compacted stream ever made with the item at either end (a claim's hold), by the index of entries that say a link (step 24). */
export async function opLinksOf(tx: Q, item: string): Promise<string[]> {
  return asCompactor(tx, async () => {
    const { rows } = await tx.query<{ id: string }>(
      `select distinct f->>1 as id from log_op, jsonb_array_elements(facts) f
        where facts @> '[["link"]]' and facts @> jsonb_build_array(jsonb_build_array('link', jsonb_build_array($1::text))) -- index log_op_links
          and f->>0 = '+' and f->>2 = 'link' and (f->3->>1 = $1 or f->3->>2 = $1)`,
      [item],
    );
    return rows.map((r) => r.id);
  });
}

/**
 * What a forget does to the compacted streams: every value sealed with one of these ids' keys, and every reason
 * sealed with one, becomes its digest (e_k2aex62z: the bytes go). The segments still verify: they hashed the digest.
 */
export async function forgetOps(tx: Q, ids: string[]): Promise<number> {
  const gone = new Set(ids);
  return asCompactor(tx, async () => {
    const { rows } = await tx.query<{ stream: string; pos: number; head: Head; facts: OpFact[] }>(
      `select stream, pos::int as pos, head, facts from log_op where exists (select 1 from jsonb_array_elements(facts) f where f->>1 = any($1::text[]))`,
      [ids],
    );
    let changed = 0;
    for (const r of rows) {
      const facts = r.facts.map((f): OpFact => (f[0] === '+' && gone.has(f[1]) && isSealed(f[3]) ? ['+', f[1], f[2], digestOf(f[3])] : f));
      const head = isSealed(r.head.reason) && gone.has(reasonKey(r.stream, r.facts)) ? { ...r.head, reason: digestOf(r.head.reason) } : r.head;
      if (JSON.stringify(facts) === JSON.stringify(r.facts) && head === r.head) continue;
      await tx.query(`update log_op set head = $3::jsonb, facts = $4::jsonb where stream = $1 and pos = $2`, [r.stream, r.pos, JSON.stringify(head), JSON.stringify(facts)]);
      changed++;
    }
    return changed;
  });
}
