// A backup's rows sealed as the log's values are (docs/log.md, section 5): what an item says, in a row of today's
// tables, goes into the file sealed with that item's key, and comes out only where the vault still holds it. The vault
// is backed up apart (src/vault.ts), so a backup taken before a forget cannot bring the forgotten item back: restored
// with the vault as it is now, its rows have no key and are left out.

import type { Q } from './db.ts';
import { isSealed, open, seal } from './seal.ts';
import { keysFor, keysIn, keysOf, type Key, type VaultDump } from './vault.ts';

type Row = Record<string, unknown>;

/** For each table, the columns that are someone's words, and the id whose key seals them (none: left clear). */
const SEALED: Record<string, { columns: string[]; key: (r: Row) => string | null }[]> = {
  entity: [{ columns: ['title', 'body', 'props'], key: (r) => r.id as string }],
  relation: [{ columns: ['props'], key: (r) => (Object.keys((r.props as Row | null) ?? {}).length ? (r.id as string) : null) }],
  event: [
    // What a forget left of an event says nothing, and makes no key for what was forgotten.
    { columns: ['detail'], key: (r) => ((r.detail as Row | null)?.forgotten ? null : ((r.target_id as string | null) ?? (r.changeset as string | null))) },
    { columns: ['reason'], key: (r) => (r.changeset as string | null) ?? ((r.detail as Row | null)?.proposal as string | undefined) ?? (r.target_id as string | null) },
  ],
  proposal: [
    { columns: ['reason'], key: (r) => r.id as string },
    { columns: ['ops', 'warnings', 'source'], key: (r) => `${r.id}/ops` },
  ],
  picture: [{ columns: ['bytes'], key: (r) => r.entity_id as string }],
};

/** Seal a dump's rows in place, making keys for what has none yet (a row written before keys were). */
export async function sealTables(q: Q, ws: string, tables: Record<string, Row[]>): Promise<void> {
  await sealBasis(q, ws, tables.event ?? []);
  // No key is made again for what was forgotten: what is left of it says nothing (an event's reason, its detail emptied).
  const forgotten = new Set((await q.query<{ id: string }>(`select id from log_fact where field = 'forgotten' and op = '+' -- index log_fact_kept`)).rows.map((r) => r.id));
  const ids = new Set<string>();
  for (const [table, parts] of Object.entries(SEALED)) for (const r of tables[table] ?? []) for (const p of parts) { const id = p.key(r); if (id && !forgotten.has(id)) ids.add(id); }
  const ring = await keysFor(q, ws, [...ids]);
  for (const [table, parts] of Object.entries(SEALED)) {
    for (const r of tables[table] ?? []) {
      for (const p of parts) {
        const id = p.key(r);
        if (!id || !ring.has(id)) continue;
        for (const c of p.columns) if (r[c] !== null && r[c] !== undefined) r[c] = seal(ring.get(id)!, `${table}.${c}`, r[c]);
      }
    }
  }
}

/** An event's basis is the change set's words, not the item's: sealed apart with the change set's key, as in the log. */
async function sealBasis(q: Q, ws: string, events: Row[]): Promise<void> {
  const told = events.filter((r) => r.changeset && (r.detail as { authority?: { basis?: unknown } } | null)?.authority?.basis !== undefined);
  const ring = await keysFor(q, ws, [...new Set(told.map((r) => r.changeset as string))]);
  for (const r of told) {
    const detail = r.detail as { authority: { basis: unknown } };
    r.detail = { ...detail, authority: { ...detail.authority, basis: seal(ring.get(r.changeset as string)!, 'event.basis', detail.authority.basis) } };
  }
}

/** Whether a dump's rows are sealed (format 2) and so need the vault to be read. */
export const sealedDump = (format: number) => format === 2;

/**
 * A sealed dump's rows opened with the keys a database's vault holds. A row of an item with no key (forgotten since,
 * or from another vault) is left out, with its links, picture and shares; a reason or detail with none reads as empty.
 */
export async function openTables(q: Q, tables: Record<string, Row[]>, vault?: VaultDump): Promise<{ tables: Record<string, Row[]>; left_out: number }> {
  const ids = new Set<string>();
  for (const [table, parts] of Object.entries(SEALED)) for (const r of tables[table] ?? []) for (const p of parts) { const id = p.key(r); if (id) ids.add(id); }
  for (const r of tables.event ?? []) { const c = r.changeset as string | null; if (c) ids.add(c); }
  const ring = new Map([...(vault ? keysIn(vault, ids) : []), ...(await keysOf(q, [...ids]))]);
  const read = (keys: Key[] | undefined, field: string, v: unknown) => (isSealed(v) ? open(keys, field, v) : v);
  const gone = new Set<string>();
  const out: Record<string, Row[]> = { ...tables };
  out.entity = (tables.entity ?? []).filter((r) => {
    const keys = ring.get(r.id as string);
    const title = read(keys, 'entity.title', r.title);
    if (title === undefined) return gone.add(r.id as string) && false;
    Object.assign(r, { title, body: read(keys, 'entity.body', r.body) ?? '', props: read(keys, 'entity.props', r.props) ?? {} });
    return true;
  });
  const kept = (id: unknown) => !gone.has(id as string);
  for (const r of out.entity) for (const c of ['owner', 'source_id']) if (!kept(r[c])) r[c] = null;
  out.relation = (tables.relation ?? []).filter((r) => kept(r.from_id) && kept(r.to_id)).map((r) => ({ ...r, source_id: kept(r.source_id) ? r.source_id : null, props: read(ring.get(r.id as string), 'relation.props', r.props) ?? {} }));
  for (const t of ['picture', 'share', 'published']) out[t] = (tables[t] ?? []).filter((r) => kept(r.entity_id));
  out.picture = out.picture.map((r) => ({ ...r, bytes: read(ring.get(r.entity_id as string), 'picture.bytes', r.bytes) }));
  out.event = (tables.event ?? []).filter((r) => kept(r.target_id)).map((r) => {
    const [detail, reason] = SEALED.event.map((p) => p.key(r));
    const opened = ((detail ? read(ring.get(detail), 'event.detail', r.detail) : r.detail) ?? { forgotten: true }) as { authority?: { basis?: unknown } };
    const basis = opened.authority?.basis;
    if (basis !== undefined) opened.authority = { ...opened.authority, basis: read(ring.get(r.changeset as string), 'event.basis', basis) };
    if (opened.authority && opened.authority.basis === undefined) delete opened.authority.basis;
    return { ...r, detail: opened, reason: (reason ? read(ring.get(reason), 'event.reason', r.reason) : r.reason) ?? '' };
  });
  out.proposal = (tables.proposal ?? []).map((r) => {
    const ops = ring.get(`${r.id}/ops`);
    const said = read(ops, 'proposal.ops', r.ops);
    return {
      ...r, reason: read(ring.get(r.id as string), 'proposal.reason', r.reason) ?? '', ops: said ?? [], warnings: read(ops, 'proposal.warnings', r.warnings) ?? [], source: read(ops, 'proposal.source', r.source) ?? null,
      ...(said === undefined && r.status === 'pending' && { status: 'superseded', note: 'Forgotten with what it touched' }),
    };
  });
  return { tables: out, left_out: gone.size };
}
