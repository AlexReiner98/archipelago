// The compacted streams (docs/log.md, section 4): operational state and observations, appended at once and never
// held or undone, each entry with the light header (v, ws, stream, pos, at, actor, rule, facts, reason). They live in
// log_op, beside the fact stream's tables, cut into one segment per day per stream. A day closed is sealed by a system
// entry in the fact stream carrying the segment's hash, so the chain commits to every operational day; compaction
// drops whole entries a retention rule (src/retention.ts) no longer keeps and records the compacted segment the same
// way. Deleting from log_op is refused by its trigger to everyone but the compaction role. What is someone's words is
// sealed with its item's key (src/opseal.ts), and a member reads only the entries about what they may see.

import { createHash } from 'node:crypto';
import { jcs } from './jcs.ts';
import { append, type Fact } from './log.ts';
import { newId, type Db, type Q } from './db.ts';
import { kept, ruleFor, type OpEntry, type Retention } from './retention.ts';
import { makePartitions, partitionMade } from './partitions.ts';
import { hashed, openOps, sealOp } from './opseal.ts';

export type OpStream = 'sessions' | 'claims' | 'notifications' | 'automations' | 'settings' | 'access' | 'observations' | `pack:${string}`;
export type OpFact = ['+', string, string, unknown] | ['-', string, string];

export interface Light {
  v: 1;
  ws: string;
  stream: OpStream;
  pos: number;
  at: string;
  actor: { id: string };
  rule: string;
  facts: OpFact[];
  reason?: string;
}

/** The rule an entry's facts are kept by, as its header names it: the stream's own when no rules are given. */
const ruleId = (rules: Retention[] | undefined, stream: string, field: string) => (rules && ruleFor(rules, stream, field)?.id) ?? stream.replace(/:.*/, '');

/**
 * Append facts to a compacted stream at once, in the transaction given. Facts kept by different rules go in entries
 * of their own, so each is compacted whole by one rule. Returns the entries appended.
 */
export async function record(tx: Q, ws: string, stream: OpStream, actor: string, facts: OpFact[], opts: { rules?: Retention[]; reason?: string } = {}): Promise<Light[]> {
  if (!facts.length) return [];
  const groups = new Map<string, OpFact[]>();
  for (const f of facts) {
    const rule = ruleId(opts.rules, stream, f[2]);
    groups.set(rule, [...(groups.get(rule) ?? []), f]);
  }
  await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.oplog'), hashtext($1))`, [stream]);
  const { rows } = await tx.query<{ now: Date; pos: number | null; at: Date | null; made: boolean }>(
    `select date_trunc('milliseconds', now()) as now, l.pos::int as pos, l.at, ${partitionMade('log_op')} as made
     from (select 1) one left join lateral pelago_log_op_last($1) l on true`,
    [stream],
  );
  if (!rows[0].made) await makePartitions(tx);
  let pos = rows[0].pos ?? 0;
  // Never before the last entry: a day's entries are one run of positions, so a segment is a range of them.
  const at = new Date(Math.max(new Date(rows[0].now).getTime(), rows[0].at ? new Date(rows[0].at).getTime() : 0)).toISOString();
  const out: Light[] = [];
  for (const [rule, of] of groups) {
    const e: Light = { v: 1, ws, stream, pos: ++pos, at, actor: { id: actor }, rule, facts: of, ...(opts.reason && { reason: opts.reason }) };
    const stored = await sealOp(tx, ws, stream, { v: 1, ws, actor: e.actor, rule, ...(opts.reason && { reason: opts.reason }) }, of);
    await tx.query(`insert into log_op (stream, pos, at, head, facts) values ($1, $2, $3, $4::jsonb, $5::jsonb)`, [stream, e.pos, at, JSON.stringify(stored.head), JSON.stringify(stored.facts)]);
    out.push(e);
  }
  return out;
}

type Row = { stream: OpStream; pos: number; at: Date; head: Omit<Light, 'stream' | 'pos' | 'at' | 'facts'>; facts: OpFact[] };
const toLight = (r: Row): Light => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts });

/**
 * A compacted stream's entries as stored, sealed, in order: all of them, or those in a range of positions. A
 * segment's range names its days too, so only the partition that holds them is read (src/partitions.ts).
 */
export async function opEntries(q: Q, stream: OpStream, range: { from?: number; to?: number; days?: [string, string] } = {}): Promise<Light[]> {
  const { rows } = await q.query<Row>(
    `select stream, pos::int as pos, at, head, facts from log_op where stream = $1 and pos >= $2 and ($3::bigint is null or pos <= $3)
       and ($4::date is null or (at >= $4::date at time zone 'UTC' and at < ($5::date + 1) at time zone 'UTC')) order by at, pos`,
    [stream, range.from ?? 1, range.to ?? null, range.days?.[0] ?? null, range.days?.[1] ?? null],
  );
  return rows.map(toLight);
}

/** The entries as their reader reads them: opened with the keys the vault holds (src/opseal.ts). */
export const readOps = async (q: Q, stream: OpStream, range: Parameters<typeof opEntries>[2] = {}) => openOps(q, await opEntries(q, stream, range));

/** SHA-256 of "pelago-segment\n" and each entry's canonical form, its sealed values as their digests, one per line. */
export function segmentHash(entries: Light[]): string {
  const h = createHash('sha256').update('pelago-segment\n');
  for (const e of entries) h.update(`${jcs(hashed(e))}\n`);
  return h.digest('hex');
}

export interface Segment {
  id: string;
  stream: OpStream;
  /** The first and last day (UTC) it covers. */
  days: [string, string];
  from: number;
  to: number;
  entries: number;
  hash: string;
  replaces?: string[];
  rules?: string[];
}

/** The segments that stand: each one asserted in the fact stream and not since replaced. */
export async function segments(q: Q, stream?: OpStream): Promise<Segment[]> {
  const { rows } = await q.query<{ id: string; op: string; value: Omit<Segment, 'id'> }>(
    `select distinct on (id) id, op, value from log_fact where stream = 'facts' and field = 'segment' order by id, pos desc, n desc`,
  );
  return rows.filter((r) => r.op === '+' && (!stream || r.value.stream === stream)).map((r) => ({ id: r.id, ...r.value })).sort((a, b) => a.stream.localeCompare(b.stream) || a.from - b.from);
}

const day = (at: string | Date) => new Date(at).toISOString().slice(0, 10);
const segId = (stream: string, days: [string, string]) => `seg_${stream.replace(/[^a-z0-9]/g, '_')}_${days[0].replaceAll('-', '')}${days[1] === days[0] ? '' : `_${days[1].replaceAll('-', '')}`}`;
const SYSTEM = { actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, source: null, undoes: null, keys: [] };

/**
 * Seal every day before `now`'s (UTC) that has entries and no segment yet: one system entry in the fact stream per
 * stream and day. Returns the segments sealed.
 */
export async function seal(db: Db, ws: string, now = new Date()): Promise<Segment[]> {
  return db.transaction(async (tx) => {
    const standing = await segments(tx);
    const covered = (stream: string, d: string) => standing.some((s) => s.stream === stream && s.days[0] <= d && d <= s.days[1]);
    const { rows } = await tx.query<{ stream: OpStream; day: string; from: number; to: number }>(
      `select stream, to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day, min(pos)::int as "from", max(pos)::int as "to"
       from log_op where at < date_trunc('day', $1::timestamptz at time zone 'UTC') at time zone 'UTC' group by 1, 2 order by 1, 2`,
      [now.toISOString()],
    );
    const sealed: Segment[] = [];
    for (const r of rows.filter((r) => !covered(r.stream, r.day))) {
      const of = await opEntries(tx, r.stream, r);
      const days: [string, string] = [r.day, r.day];
      const s: Segment = { id: segId(r.stream, days), stream: r.stream, days, from: r.from, to: r.to, entries: of.length, hash: segmentHash(of) };
      const { id, ...value } = s;
      await append(tx, ws, 'facts', { id: newId('c'), ...SYSTEM, reason: 'Day sealed', action: 'segment.seal' }, [['+', id, 'segment', value]]);
      sealed.push(s);
    }
    return sealed;
  });
}

/** When a record (a run, a notification) ended, read from the projection of the fact stream; undefined while it lives. */
export async function closedOn(q: Q, ids: string[]): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const { rows } = await q.query<{ id: string; at: Date }>(
    `select id, coalesce(archived_at, updated_at) as at from entity where id = any($1::text[]) and (not is_open or archived_at is not null)
     union all select id, valid_to from relation where id = any($1::text[]) and valid_to is not null`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, new Date(r.at)]));
}

/**
 * Compact a stream's sealed segments at `now`: drop the entries its rules no longer keep, and record each run of
 * neighbouring segments that lost any as one compacted segment in the fact stream, naming those it replaces and the
 * rules it followed. What is not sealed is not compacted. Returns the compacted segments and how many entries went.
 */
export async function compact(db: Db, ws: string, rules: Retention[], now = new Date()): Promise<{ segments: Segment[]; dropped: number }> {
  const out: Segment[] = [];
  let dropped = 0;
  for (const stream of new Set((await segments(db)).map((s) => s.stream))) {
    await db.transaction(async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.oplog'), hashtext($1))`, [stream]);
      const standing = await segments(tx, stream);
      const all = await opEntries(tx, stream, { from: standing[0].from, to: standing.at(-1)!.to });
      const ended = await closedOn(tx, [...new Set(all.flatMap((e) => e.facts.map((f) => f[1])))]);
      const keep = kept(all as OpEntry[], rules, now, (id) => ended.get(id));
      const inside = (s: Segment) => all.filter((e) => e.pos >= s.from && e.pos <= s.to);
      // Runs of neighbouring segments that each lose an entry become one segment, within a year: a segment lives in
      // the partition that holds its days (src/partitions.ts).
      const runs: Segment[][] = [];
      for (const s of standing) {
        if (!inside(s).some((e) => !keep.has(e.pos))) continue;
        const last = runs.at(-1)?.at(-1);
        if (last && standing.indexOf(last) === standing.indexOf(s) - 1 && last.days[1].slice(0, 4) === s.days[0].slice(0, 4)) runs.at(-1)!.push(s);
        else runs.push([s]);
      }
      const gone: number[] = [];
      for (const run of runs) {
        const was = run.flatMap(inside);
        const left = was.filter((e) => keep.has(e.pos));
        gone.push(...was.filter((e) => !keep.has(e.pos)).map((e) => e.pos));
        const days: [string, string] = [run[0].days[0], run.at(-1)!.days[1]];
        const s: Segment = {
          id: `${segId(stream, days)}_${newId('k').slice(2)}`, stream, days, from: run[0].from, to: run.at(-1)!.to, entries: left.length, hash: segmentHash(left),
          replaces: run.map((r) => r.id), rules: [...new Set(was.filter((e) => !keep.has(e.pos)).map((e) => e.rule))].sort(),
        };
        const { id, ...value } = s;
        await append(tx, ws, 'facts', { id: newId('c'), ...SYSTEM, reason: 'Compacted by rule', action: 'segment.compact' }, [...run.map((r): Fact => ['-', r.id, 'segment']), ['+', id, 'segment', value]]);
        out.push(s);
      }
      if (!gone.length) return;
      // The one role the append-only trigger lets delete; the transaction ends with it.
      await tx.query(`set local role pelago_compactor`);
      await tx.query(`delete from log_op where stream = $1 and pos = any($2::bigint[])`, [stream, gone]);
      dropped += gone.length;
    });
  }
  return { segments: out, dropped };
}

/** Every standing segment's entries hash to what the fact stream recorded of it. */
export async function verifySegments(q: Q): Promise<{ segments: number; problems: string[] }> {
  const problems: string[] = [];
  const standing = await segments(q);
  for (const s of standing) {
    const of = await opEntries(q, s.stream, s);
    if (of.length !== s.entries) problems.push(`${s.id}: holds ${of.length} entries, sealed with ${s.entries}`);
    else if (segmentHash(of) !== s.hash) problems.push(`${s.id}: its entries do not hash to what was sealed`);
    if (of.some((e) => day(e.at) < s.days[0] || day(e.at) > s.days[1])) problems.push(`${s.id}: holds an entry outside ${s.days.join(' to ')}`);
  }
  return { segments: standing.length, problems };
}

/** The stream each field operational writes goes to; null for what is kept in no stream (a run's heartbeat). */
export const FIELD_STREAMS: Record<string, OpStream | null> = {
  last_seen: null, active: null, busy: null,
  tokens_used: 'sessions', story: 'sessions', stale_flagged: 'sessions',
  last_run: 'automations', last_fired: 'automations', last_result: 'automations', rechecked_at: 'automations',
};

/** What an operational write leaves on an item, as facts by stream: each field it touched at its new value. */
export function operationalFacts(id: string, set: { props?: object; unset?: string[]; add?: object; reach?: object }, row: { props: Record<string, unknown>; visibility: string; private_to: string | null }) {
  const out = new Map<OpStream, OpFact[]>();
  const put = (stream: OpStream | null | undefined, f: OpFact) => stream && out.set(stream, [...(out.get(stream) ?? []), f]);
  for (const k of new Set([...Object.keys(set.props ?? {}), ...Object.keys(set.add ?? {})])) put(FIELD_STREAMS[k], row.props[k] == null ? ['-', id, k] : ['+', id, k, row.props[k]]);
  for (const k of set.unset ?? []) put(FIELD_STREAMS[k], ['-', id, k]);
  if (set.reach) {
    put('notifications', row.private_to === null ? ['-', id, 'private_to'] : ['+', id, 'private_to', row.private_to]);
    put('notifications', ['+', id, 'visibility', row.visibility]);
  }
  return [...out];
}
