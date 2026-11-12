// What a workspace uses: the bytes its log and pictures take, its agent sessions at work, and its signed-in requests
// a minute. Measured alike on every server, whatever limits it: the usage view shows them, and where a server pack
// sets a workspace limits (src/standing.ts), they are what each limit is held against.

import type { Q } from '../../database/kernel/db.ts';
import { limiter, TOKEN_LIMIT, type Limit } from './limit.ts';
import { bytes, fillUse } from '../../identity/kernel/standing.ts';

/** A session not heard from for this long is not at work: it holds no place among those at once. */
export const SESSION_AWAKE_MS = 60 * 60_000;
/** How long a workspace's storage, once measured, is taken as it was: every write asks. */
const STORAGE_KEEP_MS = 60_000;

/** A number of bytes as a person reads it: the identity root's, where a limit is said. */
export { bytes };

let measure = async (_id: string): Promise<number> => 0;
/** Where the server measures how much a workspace stores: it says, when it starts. */
export function configureUse(storageOf: (id: string) => Promise<number>): void {
  measure = storageOf;
  stored.clear();
}

/**
 * The bytes a workspace's log and pictures take on disk, indexes included, read from the database's own count of each
 * table's size: nothing is read row by row.
 */
export async function storageBytes(db: Q): Promise<number> {
  return Object.values(await storageParts(db)).reduce((a, b) => a + b, 0);
}

/** The parts storage counts, each in bytes as storageBytes reads them: the log's facts, its entries, the operational streams, the pictures. */
export const STORED_PARTS = ['log_fact', 'log_entry', 'log_op', 'picture'] as const;
export async function storageParts(db: Q): Promise<Record<(typeof STORED_PARTS)[number], number>> {
  const { rows } = await db.query<{ part: (typeof STORED_PARTS)[number]; n: string }>(
    `select part, coalesce(sum(pg_total_relation_size(relid)), 0)::bigint as n from (
       select 'log_entry' as part, relid from pg_partition_tree('log_entry') union all select 'log_fact', relid from pg_partition_tree('log_fact')
       union all select 'log_op', relid from pg_partition_tree('log_op') union all select 'picture', 'picture'::regclass as relid) t group by part`,
  );
  const out = Object.fromEntries(STORED_PARTS.map((p) => [p, 0])) as Record<(typeof STORED_PARTS)[number], number>;
  for (const r of rows) out[r.part] = Number(r.n);
  return out;
}

const stored = new Map<string, { at: number; n: number }>();
/** How much a workspace stores, measured at most once a minute. */
export async function storageOf(workspace: string, fresh = false): Promise<number> {
  const hit = stored.get(workspace);
  if (!fresh && hit && Date.now() - hit.at < STORAGE_KEEP_MS) return hit.n;
  const n = await measure(workspace);
  stored.set(workspace, { at: Date.now(), n });
  return n;
}

/** The agent sessions at work: open items of the run types, heard from in the last SESSION_AWAKE_MS. */
export async function awakeSessions(db: Q, runs: string[]): Promise<number> {
  const since = new Date(Date.now() - SESSION_AWAKE_MS).toISOString();
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from entity where type = any($2::text[]) and is_open and archived_at is null and props->>'last_seen' >= $1`, [since, runs]);
  return rows[0].n;
}

// Signed-in requests are counted a minute at a time: each token against TOKEN_LIMIT (one agent in a loop is slowed
// before it slows its neighbours), and all of a workspace's together, against its limit when it has one.
let perToken = TOKEN_LIMIT;
let byToken = limiter(perToken);
/** What one token may ask a minute, as the server is started with. */
export function slowTokensAt(limit: Limit = TOKEN_LIMIT): void {
  perToken = limit;
  byToken = limiter(limit);
}
/** What one token may ask a minute. */
export const tokenEach = () => perToken.each;
const byWorkspace = limiter({ each: Number.MAX_SAFE_INTEGER });

/** Who asked, a minute at a time, by workspace: what the usage view says the requests are made of. */
const asked = new Map<string, { began: number; by: Map<string, number> }>();
/** The requests a workspace has made this minute, by who asked (a person's id, or "agent:" and the person an agent acts for). */
export function requestsBy(workspace: string): Map<string, number> {
  const now = asked.get(workspace);
  return now && Date.now() - now.began < 60_000 ? now.by : new Map();
}
/** Whom a request is counted as, for the usage view: never the token. */
export const askedAs = (actor: { kind: string; name: string; person?: string }) => (actor.kind === 'agent' ? `agent:${actor.person ?? actor.name}` : (actor.person ?? `human:${actor.name}`));

/**
 * 0 when this request may go ahead (and it is counted), or the seconds until it may be asked again, with whether the
 * workspace's own limit (`most` a minute, when it has one) or the token's stopped it. `who` is askedAs its actor.
 */
export function takeRequest(workspace: string, token: string, most: number | undefined, who?: string): { wait: number; workspace?: boolean } {
  const waitWs = most ? byWorkspace.full(workspace, most) : 0;
  if (waitWs) return { wait: waitWs, workspace: true };
  const waitToken = byToken.take(`${workspace}:${token}`);
  if (waitToken) return { wait: waitToken };
  byWorkspace.take(workspace);
  if (who) {
    let now = asked.get(workspace);
    if (!now || Date.now() - now.began >= 60_000) asked.set(workspace, (now = { began: Date.now(), by: new Map() }));
    now.by.set(who, (now.by.get(who) ?? 0) + 1);
  }
  return { wait: 0 };
}

/** The requests a workspace has made this minute. */
export const requestsThisMinute = (workspace: string) => byWorkspace.count(workspace);

// The identity slot identity.use: a workspace's limits are held against what is measured here (src/standing.ts).
fillUse({ storageOf: (workspace) => storageOf(workspace), takeRequest, tokenEach });
