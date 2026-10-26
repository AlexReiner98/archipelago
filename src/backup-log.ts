// A backup as the log and a snapshot (docs/log.md, section 7): a file carries the log's rows whole and a snapshot of
// the projections at its head. The items, links and review queue are read from it as a rebuild reads them: the
// snapshot when it is anchored to the file's own chain, with what the log says after it projected on; else the log
// from its start, in tables that live for one transaction. What has no key in the vault it is read with (forgotten
// since) is left out, as from any backup, and so is a link whose end is not there.
//
// Whichever projector made the snapshot, it is taken: it is the map's rows as they stood, which hold what the log
// alone does not make (items from before the log, rows a merge wrote). Refused for other code, a copy made where the
// projector has moved on read only what the log says, and on 25 Oct 2026 that was 137 of 2619 items.

import type { Q } from './db.ts';
import type { Entry, Fact } from './log.ts';
import { inOrder, kindsOf, loadRows, projectEntry, projectedRows, PROJECTED, type Rows } from './replay.ts';
import { projectsApart } from './closure.ts';
import { openAll } from './seal.ts';
import { openTables } from './backup-seal.ts';
import { check, fromBackup, sealedRows } from './snapshot.ts';
import type { VaultDump } from './vault.ts';

type Row = Record<string, unknown>;

const hex = (v: unknown) => String(v).replace(/^\\x/, '');

/** The log's rows, as a backup carries them, read as entries: sealed, as they are stored. */
export function entriesOf(tables: Record<string, Row[]>): Entry[] {
  const facts = new Map<string, [number, Fact][]>();
  for (const f of tables.log_fact ?? []) {
    const key = `${f.stream}/${f.pos}`;
    const fact = (f.op === '-' ? ['-', f.id, f.field] : f.meta == null ? ['+', f.id, f.field, f.value] : ['+', f.id, f.field, f.value, f.meta]) as Fact;
    facts.set(key, [...(facts.get(key) ?? []), [f.n as number, fact]]);
  }
  return (tables.log_entry ?? []).map((e) => ({
    ...(e.head as Row),
    stream: e.stream,
    pos: Number(e.pos),
    id: e.id,
    at: new Date(e.at as string).toISOString(),
    facts: (facts.get(`${e.stream}/${e.pos}`) ?? []).sort((a, b) => a[0] - b[0]).map(([, f]) => f),
    prev: hex(e.prev),
    hash: hex(e.hash),
  })) as Entry[];
}

const isDigest = (v: unknown) => typeof v === 'object' && v !== null && '$h' in v;

/**
 * The items, links and review queue a backup's log makes, from its snapshot when one can be built on. Answers where
 * it started (the snapshot's id, or 'start') and how many items were left out for want of a key.
 */
export async function projectBackup(tx: Q, tables: Record<string, Row[]>, snapshot: Row | undefined, vault?: VaultDump): Promise<{ rows: Rows; from: string; left_out: number }> {
  const kinds = kindsOf((tables.type_def ?? []) as { id: string; def: { kind?: string; statuses?: { open?: string[] } } }[]);
  const all = entriesOf(tables).sort(inOrder);
  let start: { rows: Rows; at: { facts: number; pending: number }; id: string; left_out: number } | undefined;
  if (snapshot) {
    const s = fromBackup(snapshot);
    const anchor = s.positions.facts === 0 ? '' : all.find((e) => e.stream === 'facts' && e.pos === s.positions.facts)?.hash;
    const ws = (all[0]?.ws as string | undefined) ?? 'default';
    if (!check(ws, s, anchor, true).length) {
      const { tables: opened, left_out } = await openTables(tx, sealedRows(s), vault);
      start = { rows: { entity: opened.entity ?? [], relation: opened.relation ?? [], proposal: opened.proposal ?? [] }, at: s.positions, id: s.id, left_out };
    }
  }
  // Every projection in tables of its own: the closure and mentions too, or the projector would write the live ones.
  for (const t of PROJECTED) await tx.query(`create temp table ${t} (like public.${t} including defaults including indexes)`);
  projectsApart(tx);
  try {
    if (start) await loadRows(tx, start.rows);
    const after = all.filter((e) => !start || e.pos > start.at[e.stream as 'facts' | 'pending']);
    for (let i = 0; i < after.length; i += 2000) for (const e of await openAll(tx, after.slice(i, i + 2000), vault)) await projectEntry(tx, kinds, e);
    const rows = await projectedRows(tx);
    // An item whose key the vault no longer holds reads as digests: it was forgotten, and stays out with its links. So
    // does a link to an item the file does not make at all (left out of its snapshot for want of a key).
    const gone = new Set(rows.entity.filter((r) => isDigest(r.title)).map((r) => r.id as string));
    const here = new Set(rows.entity.map((r) => r.id as string).filter((id) => !gone.has(id)));
    const kept = (id: unknown) => here.has(id as string);
    return {
      from: start?.id ?? 'start',
      left_out: gone.size + (start?.left_out ?? 0),
      rows: {
        entity: rows.entity.filter((r) => kept(r.id)).map((r) => ({ ...r, owner: kept(r.owner) ? r.owner : null, source_id: kept(r.source_id) ? r.source_id : null })),
        relation: rows.relation.filter((r) => kept(r.from_id) && kept(r.to_id)).map((r) => ({ ...r, source_id: kept(r.source_id) ? r.source_id : null })),
        proposal: rows.proposal,
      },
    };
  } finally {
    for (const t of PROJECTED) await tx.query(`drop table if exists pg_temp.${t}`);
  }
}
