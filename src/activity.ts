// What was done that is not a change to the map and is kept in no other stream: a push heard, a share made, a pack
// turned on, an act made outside (docs/log.md, section 4). It is the activity stream of log_op, kept forever, one entry
// for each thing done: one fact, about the item it was done to (or the workspace), its field the action, its value
// what else was said. Every entry of log_op is numbered from the sequence the fact stream's facts are, so the activity
// log (src/eventlog.ts) reads change sets, this stream and what the other streams say worth showing in one order.
//
// Before 9 Nov 2026 these were rows of the event table. Each is carried into the stream once, keeping its number and
// its time (carryEvents), and the table is written no more; a backup from before is carried the same way.

import type { Db, Q } from './db.ts';
import { makePartitions } from './partitions.ts';
import { openOps } from './opseal.ts';
import { record, type Light, type OpFact } from './streams.ts';
import type { Retention } from './retention.ts';
import type { EventQuery, LoggedEvent } from './eventlog.ts';

/** Something done, as a caller says it: who, what, to what, why, and anything more. */
export interface Done {
  actor: string;
  action: string;
  target?: string;
  changeset?: string;
  reason?: string;
  detail?: Record<string, unknown>;
  /** Where it was done, when not here: `external` for a tool call imported from another app. */
  origin?: string;
  /** When it was done, when not now. */
  ts?: string;
}

/** What an entry is about when it names no item. */
const WORKSPACE = 'workspace';

/** A thing done as the one fact of its entry. */
export function doneFact(e: Done): OpFact {
  const value = {
    ...(e.detail && Object.keys(e.detail).length && { detail: e.detail }),
    ...(e.origin && e.origin !== 'pelago' && { origin: e.origin }),
    ...(e.ts && { ts: new Date(e.ts).toISOString() }),
    ...(e.changeset && { changeset: e.changeset }),
  };
  return ['+', e.target ?? WORKSPACE, e.action, value];
}

/** Where in the event table the carrying has reached. */
const CARRIED = 'activity.carried';

/**
 * Carry the event table's rows into the activity stream, those after where it last reached, in order: each keeps its
 * number, its time (unless an entry is there after it) and all it said. Run when a workspace opens and after a backup
 * is restored; a row an older app wrote while this one took over is carried the next time. Returns how many it carried.
 */
export async function carryEvents(db: Db, ws: string, rules: Retention[]): Promise<number> {
  const { rows: at } = await db.query<{ value: number }>(`select value from setting where key = $1`, [CARRIED]);
  let after = Number(at[0]?.value ?? 0);
  let carried = 0;
  for (;;) {
    const { rows } = await db.query<{ seq: number; ts: Date; origin: string; actor: string; action: string; target_id: string | null; changeset: string | null; reason: string; detail: Record<string, unknown> }>(
      `select seq::int8 as seq, ts, origin, actor, action, target_id, changeset, reason, detail from event where seq > $1 order by seq limit 500`,
      [after],
    );
    if (!rows.length) return carried;
    await db.transaction(async (tx) => {
      await makePartitions(tx, new Date(Math.min(...rows.map((r) => new Date(r.ts).getTime()))));
      for (const r of rows) {
        const ts = new Date(r.ts).toISOString();
        const fact = doneFact({ actor: r.actor, action: r.action, target: r.target_id ?? undefined, changeset: r.changeset ?? undefined, detail: r.detail, origin: r.origin, ts });
        await record(tx, ws, 'activity', r.actor, [fact], { rules, ...(r.reason && { reason: r.reason }), at: ts, seq: Number(r.seq) });
      }
      after = Number(rows.at(-1)!.seq);
      await tx.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [CARRIED, JSON.stringify(after)]);
    });
    carried += rows.length;
  }
}

type Row = { seq?: unknown; ts?: unknown; origin?: unknown; actor?: unknown; action?: unknown; target_id?: unknown; changeset?: unknown; reason?: unknown; detail?: unknown };

/**
 * A merged backup's events (its own and what its change sets did), added after this map's, each once: one already
 * here (the same time, actor, action and item) or about an item this map does not hold is left out. Returns the
 * numbers they were given, in order.
 */
export async function bringIn(tx: Q, ws: string, rules: Retention[], given: Row[]): Promise<number[]> {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const events = given.filter((e) => str(e.actor) && str(e.action) && str(e.ts)).sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
  if (!events.length) return [];
  const targets = [...new Set(events.map((e) => str(e.target_id) ?? WORKSPACE))];
  const { rows: held } = await tx.query<{ id: string }>(`select id from entity where id = any($1::text[])`, [targets]);
  const known = new Set([WORKSPACE, ...held.map((h) => h.id)]);
  const { rows } = await tx.query<{ stream: Light['stream']; pos: number; at: Date; head: Light; facts: OpFact[] }>(
    `select stream, pos::int as pos, at, head, facts from log_op where stream = 'activity' and seq is not null and facts->0->>1 = any($1::text[]) -- index log_op_about`,
    [targets],
  );
  const here = await openOps(tx, rows.map((r) => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
  const key = (ts: string, actor: string, action: string, target: string) => `${new Date(ts).toISOString()} ${actor} ${action} ${target}`;
  const seen = new Set(here.map((e) => key(((value(e.facts[0]) ?? {}) as { ts?: string }).ts ?? e.at, e.actor.id, e.facts[0][2], e.facts[0][1])));
  const seqs: number[] = [];
  await makePartitions(tx, new Date(Math.min(...events.map((e) => new Date(e.ts as string).getTime()))));
  for (const e of events) {
    const target = str(e.target_id) ?? WORKSPACE;
    const k = key(e.ts as string, e.actor as string, e.action as string, target);
    if (!known.has(target) || seen.has(k)) continue;
    seen.add(k);
    const [{ seq }] = (await tx.query<{ seq: string }>(`select nextval('event_seq_seq') as seq`)).rows;
    const done: Done = { actor: e.actor as string, action: e.action as string, target: str(e.target_id), changeset: str(e.changeset), reason: str(e.reason), detail: (e.detail ?? {}) as Record<string, unknown>, origin: str(e.origin), ts: e.ts as string };
    await record(tx, ws, 'activity', done.actor, [doneFact(done)], { rules, ...(done.reason && { reason: done.reason }), at: done.ts, seq: Number(seq) });
    seqs.push(Number(seq));
  }
  return seqs;
}

// ---- reading ------------------------------------------------------------------------------------------------------

type Shown = { action: string; reason?: (f: OpFact) => string; detail?: (f: OpFact) => Record<string, unknown> };
const value = (f: OpFact) => (f[0] === '+' ? f[3] : undefined);

/**
 * What the other streams say that the activity log shows, by stream and then by the field (or, for settings, the id) of
 * an entry's first fact, as the action it was logged as when it was an event row too. What is not here (a story, a
 * token's last use, a cursor) is state, not something done.
 */
const SHOWN: Record<string, Record<string, Shown>> = {
  settings: {
    'changes.seen': { action: 'changes.seen', reason: () => 'Looked at what agents changed', detail: (f) => ({ upto: value(f) }) },
    setting: { action: 'workspace.set', reason: (f) => `${f[2]} set to ${JSON.stringify(value(f))}` },
    secret: { action: 'workspace.set', reason: (f) => `${f[2]} ${f[0] === '+' ? 'kept' : 'removed'}` },
  },
  access: { backup_download: { action: 'workspace.backup_download', reason: (f) => `Backup of the whole workspace downloaded (${Math.round(Number((value(f) as { bytes?: number })?.bytes ?? 0) / 1024)} KB)` } },
  observations: {
    picture: { action: 'picture.stored', detail: (f) => ({ size: (value(f) as { size?: number })?.size }) },
    imported: { action: 'audit.import', detail: (f) => (value(f) as Record<string, unknown>) ?? {} },
  },
  claims: { link: { action: 'resource.claim' } },
  sessions: { stale_flagged: { action: 'run.stale' } },
  automations: { last_fired: { action: 'automation.fire' }, rechecked_at: { action: 'recheck.done' } },
};

/** A setting someone set, not one the server keeps for itself (what a workspace began with, who its owner is). */
const shownSetting = (actor: string, f: OpFact) => actor !== 'system' && f[2] !== 'me';

/** The key an entry's first fact is shown by: settings by its id, the rest by its field. */
const keyOf = (stream: string, f: OpFact) => (stream === 'settings' && (f[1] === 'setting' || f[1] === 'secret') ? f[1] : f[2]);

/** The streams and keys whose entries the log shows, all or those of one action. */
function kinds(action?: string): { streams: string[]; keys: string[] } {
  const out = { streams: ['activity'], keys: [action ?? '*'] };
  for (const [stream, keys] of Object.entries(SHOWN)) for (const [key, shown] of Object.entries(keys)) {
    if (action && shown.action !== action && !(stream === 'claims' && action === 'resource.release')) continue;
    out.streams.push(stream);
    out.keys.push(key);
  }
  return out;
}

/** True of an entry that was written here, false of one that arrived in a merged backup: those are history, not news. */
export const notImported = (o: string) =>
  `not exists (select 1 from log_op imp where imp.seq is not null and imp.facts->0->>2 = 'workspace.import' and ${o}.seq between (imp.facts->0->3->'detail'->>'first_seq')::bigint and (imp.facts->0->3->'detail'->>'last_seq')::bigint) -- index log_op_action
`;

/** What the actor's id says of where it was done: a tool call imported from another app is `external`. */
const ORIGIN = `case when o.head->'actor'->>'id' like 'external:%' then 'external' else 'pelago' end`;

/** What was done outside change sets, newest (or oldest) first, through the viewer's rows: an entry about what they may not see is not theirs. */
export async function doneEvents(db: Q, input: EventQuery, limit: number): Promise<LoggedEvent[]> {
  const { streams, keys } = kinds(input.action);
  const where = [`o.seq is not null`, `exists (select 1 from unnest($1::text[], $2::text[]) k(s, f) where o.stream = k.s and (k.f = '*' or o.facts->0->>2 = k.f or o.facts->0->>1 = k.f))`];
  const params: unknown[] = [streams, keys];
  const add = (sql: string, v: unknown) => where.push(sql.replaceAll('?', `$${params.push(v)}`));
  if (input.since) add(`o.at >= ?::timestamptz`, input.since);
  if (input.before) add(`o.seq < ?`, input.before);
  if (input.after !== undefined) add(`o.seq > ?`, input.after);
  if (input.target) add(`(o.facts->0->>1 = ? or (o.stream = 'claims' and (o.facts->0->3->>2 = ? or r.to_id = ?)))`, input.target);
  if (input.actor) add(`o.head->'actor'->>'id' = ?`, input.actor);
  if (input.actorLike) add(`o.head->'actor'->>'id' like ?`, input.actorLike);
  if (input.origin) add(`${ORIGIN} = ?`, input.origin);
  if (input.news) where.push(notImported('o'));
  const { rows } = await db.query<{ stream: Light['stream']; pos: number; at: Date; head: Light; facts: OpFact[]; seq: string; ended: string | null }>(
    `select o.stream, o.pos::int as pos, o.at, o.head, o.facts, o.seq::int8 as seq, r.to_id as ended
     from log_op o left join relation r on o.stream = 'claims' and r.id = o.facts->0->>1
     where ${where.join(' and ')} order by o.seq ${input.oldest ? 'asc' : 'desc'} limit $${params.push(limit)}`,
    params,
  );
  const opened = await openOps(db, rows.map((r) => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
  const out: Omit<LoggedEvent, 'target_title' | 'target_type'>[] = [];
  rows.forEach((r, i) => {
    const e = opened[i];
    const f = e.facts[0];
    const base = { seq: Number(r.seq), ts: e.at, origin: 'pelago', actor: e.actor.id, changeset: null, reason: typeof e.reason === 'string' ? e.reason : '' };
    if (r.stream === 'activity') {
      const v = (value(f) ?? {}) as { detail?: Record<string, unknown>; origin?: string; ts?: string; changeset?: string };
      out.push({ ...base, ts: v.ts ?? e.at, origin: v.origin ?? (e.actor.id.startsWith('external:') ? 'external' : 'pelago'), action: f[2], target_id: f[1] === WORKSPACE ? null : f[1], changeset: v.changeset ?? null, detail: v.detail ?? {} });
      return;
    }
    const shown = SHOWN[r.stream]?.[keyOf(r.stream, f)];
    if (r.stream === 'settings' && !shownSetting(e.actor.id, f)) return;
    if (!shown || (f[0] === '-' && r.stream !== 'claims' && r.stream !== 'settings')) return;
    if (r.stream === 'claims') {
      // A claim names the link's ends; its release only the link, whose end the link's row still holds.
      const ends = value(f) as [string, string, string] | undefined;
      const resource = ends?.[2] ?? r.ended;
      const action = f[0] === '+' ? 'resource.claim' : 'resource.release';
      if (input.action && input.action !== action) return;
      out.push({ ...base, action, target_id: resource ?? null, detail: { holder: ends?.[1] } });
      return;
    }
    out.push({ ...base, action: shown.action, target_id: f[1].startsWith('e_') || f[1].startsWith('r_') ? f[1] : null, reason: base.reason || shown.reason?.(f) || '', detail: shown.detail?.(f) ?? {} });
  });
  const ids = [...new Set(out.map((o) => o.target_id).filter((id): id is string => Boolean(id)))];
  const { rows: seen } = await db.query<{ id: string; title: string; type: string }>(`select id, title, type from entity where id = any($1::text[])`, [ids]);
  const known = new Map(seen.map((s) => [s.id, s]));
  return out.map((o) => ({ ...o, target_title: o.target_id ? (known.get(o.target_id)?.title ?? null) : null, target_type: o.target_id ? (known.get(o.target_id)?.type ?? null) : null }));
}

/** How many of each action the activity log holds since a time, of what was done outside change sets. */
export async function doneCounts(db: Q, since: string): Promise<Map<string, number>> {
  const { streams, keys } = kinds();
  const { rows } = await db.query<{ stream: string; actor: string; id: string; field: string; op: string; n: number }>(
    `select o.stream, o.head->'actor'->>'id' as actor, case when o.stream = 'settings' then o.facts->0->>1 end as id, o.facts->0->>2 as field, o.facts->0->>0 as op, count(*)::int as n from log_op o
     where o.seq is not null and o.at >= $3::timestamptz
       and exists (select 1 from unnest($1::text[], $2::text[]) k(s, f) where o.stream = k.s and (k.f = '*' or o.facts->0->>2 = k.f or o.facts->0->>1 = k.f))
     group by 1, 2, 3, 4, 5`,
    [streams, keys, since],
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const f = [r.op, r.id, r.field] as unknown as OpFact;
    if (r.stream === 'settings' && !shownSetting(r.actor, f)) continue;
    const action = r.stream === 'activity' ? r.field : r.stream === 'claims' ? (r.op === '+' ? 'resource.claim' : 'resource.release') : SHOWN[r.stream]?.[keyOf(r.stream, f)]?.action;
    if (action) counts.set(action, (counts.get(action) ?? 0) + r.n);
  }
  return counts;
}

/** The newest number anything in the activity log has: a cursor's start. */
export async function lastSeq(db: Q): Promise<number> {
  const { rows } = await db.query<{ seq: string }>(
    `select greatest((select coalesce(max(seq), 0) from log_fact), (select coalesce(max(seq), 0) from log_op where seq is not null)) as seq -- index log_fact_seq, log_op_seq`,
  );
  return Number(rows[0].seq);
}
