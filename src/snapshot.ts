// Snapshots of the projections (docs/log.md, section 7): the rows the projector made from the log up to a position in
// each stream, kept so a rebuild, an as-of read or a restore starts there and projects only what came after. A
// snapshot is anchored to the chain by the hash of the fact entry at its position, stamped with the version and the
// code of the projector that made it, and its rows are sealed per item as the log's values are, so a forget reaches
// it through the vault. It is not part of the log: it can be deleted and taken again.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Q } from './db.ts';
import { jcs } from './jcs.ts';
import { openTables, sealTables } from './backup-seal.ts';
import type { VaultDump } from './vault.ts';
import type { Rows } from './replay.ts';

/** Step 23: where snapshots are kept, and the schema a rebuild projects into beside the live tables. Neither is a member's. */
export const SNAPSHOT = `
create table if not exists log_snapshot (
  id                 text primary key,
  projection         text not null,
  projection_version int not null,
  code               text not null,
  positions          jsonb not null,
  fact_pos           bigint not null,
  fact_hash          bytea not null,
  taken_at           timestamptz not null,
  rows               bytea not null,
  hash               bytea not null
);
create index if not exists log_snapshot_pos on log_snapshot (projection, fact_pos);
revoke all on log_snapshot from public;
create schema if not exists pelago_rebuild;
revoke all on schema pelago_rebuild from public;
`;

/** The projection a snapshot holds: today's items, links and review queue. */
export const PROJECTION = 'current_state';

/** Raised by hand when what the projector makes changes in meaning; the code's digest below catches the rest. */
export const PROJECTION_VERSION = 1;

/** The projector's own code, by digest: a snapshot made by other code is not this projection's, whatever its version says. */
export const CODE = createHash('sha256')
  .update(['replay.ts', 'facts.ts'].map((f) => readFileSync(join(import.meta.dirname, f), 'utf8')).join('\0'))
  .digest('hex')
  .slice(0, 16);

export type Positions = { facts: number; pending: number };

export interface Snapshot {
  v: 1;
  ws: string;
  id: string;
  projection: string;
  projection_version: number;
  code: string;
  positions: Positions;
  fact_hash: string;
  taken_at: string;
  hash: string;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
/** A snapshot's hash: its header canonical, then its rows by the digest of the bytes kept (sealed, so a forget changes none of them). */
export const hashOf = (head: Omit<Snapshot, 'hash' | 'id'>, rows: Buffer) => sha256(`pelago-snapshot\n${jcs(head)}\n${sha256(rows)}`);

/** The hash of the fact entry at a position: the genesis has none. */
async function anchorAt(q: Q, pos: number): Promise<string | undefined> {
  if (pos === 0) return '';
  const { rows } = await q.query<{ hash: string }>(`select encode(hash, 'hex') as hash from log_entry where stream = 'facts' and pos = $1`, [pos]);
  return rows[0]?.hash;
}

/** A projection's rows, in clear, made a snapshot at these positions: sealed per item, hashed, anchored. */
async function make(q: Q, ws: string, positions: Positions, rows: Rows): Promise<{ snapshot: Snapshot; bytes: Buffer }> {
  const sealed = structuredClone(rows) as Record<string, Record<string, unknown>[]>;
  await sealTables(q, ws, sealed);
  const bytes = Buffer.from(JSON.stringify(sealed), 'utf8');
  const fact_hash = (await anchorAt(q, positions.facts)) ?? '';
  const head = { v: 1 as const, ws, projection: PROJECTION, projection_version: PROJECTION_VERSION, code: CODE, positions, fact_hash, taken_at: new Date().toISOString() };
  return { snapshot: { ...head, id: `s_${positions.facts}_${positions.pending}_${CODE}`, hash: hashOf(head, bytes) }, bytes };
}

/** Keep a projection's rows as a snapshot at these positions. */
export async function takeSnapshot(q: Q, ws: string, positions: Positions, rows: Rows): Promise<Snapshot> {
  const { snapshot: snap, bytes } = await make(q, ws, positions, rows);
  await q.query(
    `insert into log_snapshot (id, projection, projection_version, code, positions, fact_pos, fact_hash, taken_at, rows, hash)
     values ($1, $2, $3, $4, $5::jsonb, $6, decode($7, 'hex'), $8, $9, decode($10, 'hex'))
     on conflict (id) do update set projection_version = excluded.projection_version, code = excluded.code, fact_hash = excluded.fact_hash, taken_at = excluded.taken_at, rows = excluded.rows, hash = excluded.hash`,
    [snap.id, snap.projection, snap.projection_version, snap.code, JSON.stringify(positions), positions.facts, snap.fact_hash, snap.taken_at, gzipSync(bytes), snap.hash],
  );
  return snap;
}

/**
 * The live projections at the head of both streams, as a snapshot a backup carries beside the log (its rows gzipped,
 * in base64). Read in the backup's own transaction, so rows and positions are of one moment. It holds what the log
 * alone does not make (rows a merge wrote, a claim's link, the operational fields on an item), and is not kept here:
 * a rebuild starts only from snapshots the projector made.
 */
export async function liveSnapshot(q: Q, ws: string): Promise<Record<string, unknown>> {
  const { rows: [at] } = await q.query<Positions>(
    `select coalesce((select pos from log_entry where stream = 'facts' order by at desc, pos desc limit 1), 0)::int as facts,
            coalesce((select pos from log_entry where stream = 'pending' order by at desc, pos desc limit 1), 0)::int as pending`,
  );
  const rows = {} as Rows;
  for (const t of ['entity', 'relation', 'proposal'] as const) rows[t] = (await q.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from public.${t} t order by id`)).rows.map((r) => r.row);
  const { snapshot, bytes } = await make(q, ws, at, rows);
  const { v: _v, ws: _w, ...kept } = snapshot;
  return { ...kept, rows: gzipSync(bytes).toString('base64') };
}

export type Stored = Omit<Snapshot, 'v' | 'ws'> & { rows: Buffer };
const SELECT = `select id, projection, projection_version, code, positions, encode(fact_hash, 'hex') as fact_hash, taken_at, rows, encode(hash, 'hex') as hash from log_snapshot`;

/**
 * What is wrong with a snapshot, for this code and a chain whose fact entry at its position has the hash `anchor`
 * (undefined when there is no such entry): nothing when it can be built on. `anyCode`: whichever projector made it, as
 * for a backup's, which is the map's rows as they stood and not a projection to build on (src/backup-log.ts).
 */
export function check(ws: string, s: Stored, anchor: string | undefined, anyCode = false): string[] {
  const out: string[] = [];
  if (!anyCode && s.projection_version !== PROJECTION_VERSION) out.push(`made by projection version ${s.projection_version}, this code is ${PROJECTION_VERSION}`);
  if (!anyCode && s.code !== CODE) out.push(`made by other projector code (${s.code}, this is ${CODE})`);
  if (anchor === undefined) out.push(`the fact stream has no entry ${s.positions.facts}`);
  else if (anchor !== s.fact_hash) out.push(`fact entry ${s.positions.facts} is not the one it was taken at`);
  const head = { v: 1 as const, ws, projection: s.projection, projection_version: s.projection_version, code: s.code, positions: s.positions, fact_hash: s.fact_hash, taken_at: new Date(s.taken_at).toISOString() };
  let bytes: Buffer | undefined;
  try {
    bytes = gunzipSync(s.rows);
  } catch {
    out.push('its rows cannot be read');
  }
  if (bytes && hashOf(head, bytes) !== s.hash) out.push('its hash is not that of what it holds');
  return out;
}

export const problems = async (q: Q, ws: string, s: Stored) => check(ws, s, await anchorAt(q, s.positions.facts));

/** A snapshot's rows as kept, sealed: what openTables opens. */
export const sealedRows = (s: Stored) => JSON.parse(gunzipSync(s.rows).toString('utf8')) as Record<string, Record<string, unknown>[]>;

/** A snapshot as a backup carries it (liveSnapshot), read back. */
export const fromBackup = (row: Record<string, unknown>): Stored => ({ ...(row as unknown as Stored), rows: Buffer.from(String(row.rows), 'base64') });

/** Every snapshot kept, newest first, with what keeps each from being built on. */
export async function snapshots(q: Q, ws: string): Promise<(Snapshot & { problems: string[] })[]> {
  const { rows } = await q.query<Stored>(`${SELECT} order by fact_pos desc, (positions->>'pending')::bigint desc`);
  return Promise.all(rows.map(async ({ rows: _r, ...s }) => ({ v: 1 as const, ws, ...s, taken_at: new Date(s.taken_at).toISOString(), problems: await problems(q, ws, { ...s, rows: _r }) })));
}

/**
 * The newest snapshot this code can build on, at or before a fact position (the head when none is given), with its
 * rows opened: undefined when there is none, and the log is projected from its start. One refused is passed over.
 */
export async function newestValid(q: Q, ws: string, upTo?: number, vault?: VaultDump): Promise<{ snapshot: Snapshot; rows: Rows } | undefined> {
  const { rows } = await q.query<Stored>(
    `${SELECT} where projection = $1 and projection_version = $2 and code = $3 and ($4::bigint is null or fact_pos <= $4) order by fact_pos desc, (positions->>'pending')::bigint desc`,
    [PROJECTION, PROJECTION_VERSION, CODE, upTo ?? null],
  );
  for (const s of rows) {
    if ((await problems(q, ws, s)).length) continue;
    const { tables } = await openTables(q, sealedRows(s), vault);
    const { rows: _r, ...head } = s;
    return { snapshot: { v: 1, ws, ...head, taken_at: new Date(s.taken_at).toISOString() }, rows: { entity: tables.entity ?? [], relation: tables.relation ?? [], proposal: tables.proposal ?? [] } };
  }
  return undefined;
}

/** Keep the newest few snapshots this code can use and drop the rest: they can always be taken again. */
export async function prune(q: Q, keep = 3): Promise<number> {
  const { rows } = await q.query(
    `delete from log_snapshot where id not in (select id from log_snapshot where projection = $1 and projection_version = $2 and code = $3 order by fact_pos desc limit $4) returning 1`,
    [PROJECTION, PROJECTION_VERSION, CODE, keep],
  );
  return rows.length;
}

