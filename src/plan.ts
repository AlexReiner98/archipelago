// What a workspace's plan allows: members, storage, requests a minute, agent sessions at once and looks an hour. Like
// whether it has ended (src/ended.ts), it is the server's to keep, set by the server pack that sold the workspace (its
// act workspace.limit, src/server-acts.ts) in the control values of the default workspace's database. Each limit is
// optional, and one left out is no limit at all, as on a server nobody sells.
//
// Over a limit, what would add to it is refused with a plain answer naming the plan and where to change it; what is
// there is never hidden or lost: reads, export and the backup download go on working, so a customer can always leave.
// The write path (src/pelago.ts) asks roomToStore, a session starting (src/sessions.ts) roomForSession, a look
// (src/looks.ts) looksAllowed, a signed-in request (src/server.ts) requestWait, and adding a member src/members.ts.

import type { Q } from './db.ts';
import { limiter, TOKEN_LIMIT, type Limit } from './limit.ts';

export interface Limits {
  /** The most members. */
  members?: number;
  /** The most bytes the log and the pictures may take. */
  storage?: number;
  /** The most signed-in requests a minute, all of the workspace's tokens together. */
  requests?: number;
  /** The most agent sessions at work at once. */
  sessions?: number;
  /** The most looks an hour. */
  looks?: number;
  /** What to say to whoever meets a limit (how to make room), what the workspace is on ("Solo"), and where its admin manages that. */
  note?: string;
  plan?: string;
  manage?: string;
  /** What the link to manage it says, when not the usual. */
  manage_says?: string;
  /** The day a plan with an end runs out (a trial's): the pack that sold it ends the workspace then. */
  until?: string;
}

/** The limits a plan can set, each with how much of it is one: what workspace.limit takes and the Plan card shows. */
export const LIMITS = ['members', 'storage', 'requests', 'sessions', 'looks'] as const;
export type LimitName = (typeof LIMITS)[number];
/** The largest each may be set to. */
const MOST: Record<LimitName, number> = { members: 10_000, storage: 2 ** 50, requests: 1_000_000, sessions: 10_000, looks: 100_000 };
/** A session not heard from for this long is not at work: it holds no place among those at once. */
export const SESSION_AWAKE_MS = 60 * 60_000;
/** A share of a limit past which its workspace is told, on its Plan card. */
export const NEAR = 0.8;
/** How long a workspace's storage, once measured, is taken as it was: every write asks. */
const STORAGE_KEEP_MS = 60_000;
/** How long a workspace's limits, once read, are taken as they were: every signed-in request asks. */
const LIMITS_KEEP_MS = 10_000;

let site = {
  limitOf: async (_id: string): Promise<Limits | undefined> => undefined,
  nameOf: async (id: string) => id,
  storageOf: async (_id: string): Promise<number> => 0,
};
/** Where the server reads a workspace's limits, its name, and how much it stores: it says, when it starts. */
export function configurePlan(given: Partial<typeof site>): void {
  site = { ...site, ...given };
  stored.clear();
  read.clear();
}

const read = new Map<string, { at: number; value: Limits | undefined }>();
/** A workspace's limits, as the server says them. */
export async function limitOf(workspace: string): Promise<Limits | undefined> {
  const hit = read.get(workspace);
  if (hit && Date.now() - hit.at < LIMITS_KEEP_MS) return hit.value;
  const value = await site.limitOf(workspace);
  read.set(workspace, { at: Date.now(), value });
  return value;
}
/** Its limits were set again: read them afresh. */
export const limitsChanged = (workspace: string) => void read.delete(workspace);

/** Limits from what a pack sent: each a whole number from 1, or left out (or null) for none. Null when none is set. */
export function limitsFrom(input: Record<string, unknown>, said: Omit<Limits, LimitName>): Limits | null {
  const limits: Limits = {};
  for (const name of LIMITS) {
    const v = input[name];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!(Number.isInteger(n) && n >= 1 && n <= MOST[name])) throw new Error(`${name}: a whole number from 1, or null for no limit.`);
    limits[name] = n;
  }
  if (!LIMITS.some((name) => limits[name] !== undefined)) return null;
  return { ...limits, ...Object.fromEntries(Object.entries(said).filter(([, v]) => v)) };
}

/** Days until a plan's end, counting the day it is in: what its Plan card shows. */
export const daysLeft = (until: string, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(until) - now) / 86_400_000));

const UNIT: Record<LimitName, (n: number) => string> = {
  members: (n) => `${n} member${n === 1 ? '' : 's'}`,
  storage: (n) => bytes(n),
  requests: (n) => `${n} request${n === 1 ? '' : 's'} a minute`,
  sessions: (n) => `${n} agent session${n === 1 ? '' : 's'} at once`,
  looks: (n) => `${n} look${n === 1 ? '' : 's'} an hour`,
};
/** A number of bytes as a person reads it. */
export const bytes = (n: number) => (n >= 1e9 ? `${+(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} kB` : `${n} bytes`);

/** The refusal at a limit: what the plan has room for, what is used, and how to make room. */
export async function overLimit(workspace: string, limits: Limits, name: LimitName, used: number, what: string): Promise<Error> {
  const room = UNIT[name](limits[name]!);
  const on = limits.plan ? ` on the ${limits.plan} plan` : '';
  const manage = limits.manage ? ` Change the plan at ${limits.manage}.` : '';
  return new Error(`${await site.nameOf(workspace)} has room for ${room}${on}, and ${name === 'storage' ? `holds ${bytes(used)}` : `has ${used}`}: ${what}.${limits.note ? ` ${limits.note}` : ''}${manage}`);
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
  const n = await site.storageOf(workspace);
  stored.set(workspace, { at: Date.now(), n });
  return n;
}

/** Refuse a write to a workspace whose log and pictures take all the storage its plan has. */
export async function roomToStore(workspace: string): Promise<void> {
  const limits = await limitOf(workspace);
  if (!limits?.storage) return;
  const used = await storageOf(workspace);
  if (used >= limits.storage) throw await overLimit(workspace, limits, 'storage', used, 'nothing more is written until there is room. What is there can still be read and its backup downloaded');
}

/** The agent sessions at work: open items of the run types, heard from in the last SESSION_AWAKE_MS. */
export async function awakeSessions(db: Q, runs: string[]): Promise<number> {
  const since = new Date(Date.now() - SESSION_AWAKE_MS).toISOString();
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from entity where type = any($2::text[]) and is_open and archived_at is null and props->>'last_seen' >= $1`, [since, runs]);
  return rows[0].n;
}

/** Refuse one more agent session past the plan's, counting those at work (`awake`) now. */
export async function roomForSession(workspace: string, awake: () => Promise<number>): Promise<void> {
  const limits = await limitOf(workspace);
  if (!limits?.sessions) return;
  const n = await awake();
  if (n >= limits.sessions) throw await overLimit(workspace, limits, 'sessions', n, 'end one, or let one go quiet for an hour, before another starts');
}

/** The looks a workspace may have in an hour: its plan's, else `otherwise`. */
export async function looksAllowed(workspace: string, otherwise: number): Promise<{ most: number; limits?: Limits }> {
  const limits = await limitOf(workspace);
  return limits?.looks ? { most: limits.looks, limits } : { most: otherwise };
}

// Signed-in requests are counted a minute at a time: each token against TOKEN_LIMIT (one agent in a loop is slowed
// before it slows its neighbours), and all of a workspace's together against its plan's, when it has one.
let perToken = TOKEN_LIMIT;
let byToken = limiter(perToken);
/** What one token may ask a minute, as the server is started with. */
export function slowTokensAt(limit: Limit = TOKEN_LIMIT): void {
  perToken = limit;
  byToken = limiter(limit);
}
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

/** 0 when this request may go ahead (and it is counted), or the seconds until it may be asked again. `who` is askedAs its actor. */
export async function requestWait(workspace: string, token: string, who?: string): Promise<number> {
  const most = (await limitOf(workspace))?.requests;
  const waitWs = most ? byWorkspace.full(workspace, most) : 0;
  if (waitWs) return waitWs;
  const waitToken = byToken.take(`${workspace}:${token}`);
  if (waitToken) return waitToken;
  byWorkspace.take(workspace);
  if (who) {
    let now = asked.get(workspace);
    if (!now || Date.now() - now.began >= 60_000) asked.set(workspace, (now = { began: Date.now(), by: new Map() }));
    now.by.set(who, (now.by.get(who) ?? 0) + 1);
  }
  return 0;
}

/** The refusal of a request past the plan's or a token's rate. */
export async function tooManyRequests(workspace: string, wait: number): Promise<string> {
  const limits = await limitOf(workspace);
  const plan = limits?.requests && byWorkspace.count(workspace) >= limits.requests;
  return plan ? (await overLimit(workspace, limits, 'requests', byWorkspace.count(workspace), `try again in ${wait} seconds`)).message : `This token has made ${perToken.each} requests this minute: try again in ${wait} seconds.`;
}

/**
 * How much of each limit a workspace uses, as its Plan card shows it: near from NEAR of it, over at all of it. Seats
 * are paid for to be filled: they are over only past the limit, and a plan of one seat is never near it.
 */
export function useOf(limits: Limits, used: Record<LimitName, number>) {
  return LIMITS.filter((name) => limits[name]).map((name) => {
    const most = limits[name]!, n = used[name], seats = name === 'members';
    return { name, used: n, most, shown: name === 'storage' ? bytes(n) : String(n), of: UNIT[name](most), near: n >= most * NEAR && !(seats && most === 1), over: seats ? n > most : n >= most };
  });
}

/** The requests a workspace has made this minute. */
export const requestsThisMinute = (workspace: string) => byWorkspace.count(workspace);
