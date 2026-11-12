// A workspace's standing: what the server says may be done there beyond what its own map decides. The server pack
// that made a workspace says it (its gate standing, src/server-gates.ts): the limits it may use (members, storage,
// requests a minute, agent sessions at once, looks an hour), and whether it has ended. The kernel keeps none of it,
// and with nothing said, as on a server with no such pack, nothing is limited and nothing has ended.
//
// Over a limit, what would add to it is refused with a plain answer and the pack's note; what is there is never hidden
// or lost: reads, export and the backup download go on working, so a workspace can always leave. An ended workspace
// is read-only until its day to be deleted, when the server's leader deletes it (src/workspaces.ts).
// The write path (src/pelago.ts) asks stillWritable and roomToStore, a session starting (src/sessions.ts)
// roomForSession, a look (src/looks.ts) looksAllowed, a signed-in request (src/server.ts) requestWait, and adding a
// member src/members.ts.

import { bytes, storageOf, takeRequest, tokenEach } from '../../../src/workspace-use.ts';

export interface Limits {
  members?: number;
  /** The most bytes the log and the pictures may take. */
  storage?: number;
  /** The most signed-in requests a minute, all of the workspace's tokens together. */
  requests?: number;
  /** The most agent sessions at work at once. */
  sessions?: number;
  /** The most looks an hour. */
  looks?: number;
  /** What to say to whoever meets a limit: how to make room. */
  note?: string;
}

export interface Ended {
  /** When it ended, and when it is deleted. */
  since: string;
  delete_at: string;
  /** What to do about it. */
  note?: string;
}

export interface Standing {
  limits?: Limits;
  ended?: Ended;
}

/** The limits a pack can set, as the Limits card shows them. */
export const LIMITS = ['members', 'storage', 'requests', 'sessions', 'looks'] as const;
export type LimitName = (typeof LIMITS)[number];
/** The largest each may be. */
const MOST: Record<LimitName, number> = { members: 10_000, storage: 2 ** 50, requests: 1_000_000, sessions: 10_000, looks: 100_000 };
/** A share of a limit past which its workspace is told, on its Limits card. */
export const NEAR = 0.8;
/** How long a workspace's standing, once read, is taken as it was: every signed-in request asks. */
const KEEP_MS = 10_000;

const said = (v: unknown, most: number) => (typeof v === 'string' && v.trim() && v.length <= most ? v.trim() : undefined);
const when = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** A standing from what a pack answered: each limit a whole number from 1 to its most, else left out; nothing well formed, none. */
export function standingFrom(answer: unknown): Standing | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const { limits: given, ended: end } = answer as Record<string, unknown>;
  const out: Standing = {};
  if (given && typeof given === 'object') {
    const limits: Limits = {};
    for (const name of LIMITS) {
      const n = Number((given as Record<string, unknown>)[name]);
      if (Number.isInteger(n) && n >= 1 && n <= MOST[name]) limits[name] = n;
    }
    const note = said((given as Record<string, unknown>).note, 300);
    if (LIMITS.some((name) => limits[name] !== undefined)) out.limits = { ...limits, ...(note && { note }) };
  }
  if (end && typeof end === 'object') {
    const { since, delete_at, note } = end as Record<string, unknown>;
    if (when(since) && when(delete_at)) out.ended = { since: new Date(since as string).toISOString(), delete_at: new Date(delete_at as string).toISOString(), ...(said(note, 300) && { note: said(note, 300) }) };
  }
  return out.limits || out.ended ? out : undefined;
}

let site = {
  read: async (_id: string): Promise<Standing | undefined> => undefined,
  nameOf: async (id: string) => id,
};
const kept = new Map<string, { at: number; value: Standing | undefined }>();
/** Where the server reads a workspace's standing and its name: it says, when it starts. */
export function configureStanding(given: Partial<typeof site>): void {
  site = { ...site, ...given };
  kept.clear();
}

/** What a workspace is called, as the server keeps it: its id where the server says nothing or cannot be asked, since a name never stops what asks it. */
export const workspaceName = (workspace: string): Promise<string> => site.nameOf(workspace).catch(() => workspace);

/** A workspace's standing, as its pack last said it. */
export async function standingOf(workspace: string, fresh = false): Promise<Standing | undefined> {
  const hit = kept.get(workspace);
  if (!fresh && hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const value = await site.read(workspace);
  kept.set(workspace, { at: Date.now(), value });
  return value;
}
/** What a pack says may have changed: read afresh, one workspace or all. */
export const standingChanged = (workspace?: string) => void (workspace ? kept.delete(workspace) : kept.clear());

export const limitOf = async (workspace: string) => (await standingOf(workspace))?.limits;
export const endedOf = async (workspace: string) => (await standingOf(workspace))?.ended;

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Refuse a write to a workspace that has ended, saying until when it can be taken away. */
export async function stillWritable(workspace: string): Promise<void> {
  const ended = await endedOf(workspace);
  if (!ended) return;
  throw new Error(`This workspace ended on ${day(ended.since)} and is read-only: it is deleted on ${day(ended.delete_at)}. Download its backup in Settings.${ended.note ? ` ${ended.note}` : ''}`);
}

const UNIT: Record<LimitName, (n: number) => string> = {
  members: (n) => `${n} member${n === 1 ? '' : 's'}`,
  storage: (n) => bytes(n),
  requests: (n) => `${n} request${n === 1 ? '' : 's'} a minute`,
  sessions: (n) => `${n} agent session${n === 1 ? '' : 's'} at once`,
  looks: (n) => `${n} look${n === 1 ? '' : 's'} an hour`,
};

/** The refusal at a limit: what there is room for, what is used, and how to make room. */
export async function overLimit(workspace: string, limits: Limits, name: LimitName, used: number, what: string): Promise<Error> {
  const room = UNIT[name](limits[name]!);
  return new Error(`${await workspaceName(workspace)} has room for ${room}, and ${name === 'storage' ? `holds ${bytes(used)}` : `has ${used}`}: ${what}.${limits.note ? ` ${limits.note}` : ''}`);
}

/** Refuse a write to a workspace whose log and pictures take all the storage it may. */
export async function roomToStore(workspace: string): Promise<void> {
  const limits = await limitOf(workspace);
  if (!limits?.storage) return;
  const used = await storageOf(workspace);
  if (used >= limits.storage) throw await overLimit(workspace, limits, 'storage', used, 'nothing more is written until there is room. What is there can still be read and its backup downloaded');
}

/** Refuse one more agent session past the limit, counting those at work (`awake`) now. */
export async function roomForSession(workspace: string, awake: () => Promise<number>): Promise<void> {
  const limits = await limitOf(workspace);
  if (!limits?.sessions) return;
  const n = await awake();
  if (n >= limits.sessions) throw await overLimit(workspace, limits, 'sessions', n, 'end one, or let one go quiet for an hour, before another starts');
}

/** The looks a workspace may have in an hour: its limit, else `otherwise`. */
export async function looksAllowed(workspace: string, otherwise: number): Promise<{ most: number; limits?: Limits }> {
  const limits = await limitOf(workspace);
  return limits?.looks ? { most: limits.looks, limits } : { most: otherwise };
}

/** 0 when this request may go ahead (and it is counted), else the seconds to wait and the refusal to give. `who` is askedAs its actor. */
export async function requestWait(workspace: string, token: string, who?: string): Promise<{ wait: number; refusal?: string }> {
  const limits = await limitOf(workspace);
  const { wait, workspace: theirs } = takeRequest(workspace, token, limits?.requests, who);
  if (!wait) return { wait };
  const refusal = theirs ? (await overLimit(workspace, limits!, 'requests', limits!.requests!, `try again in ${wait} seconds`)).message : `This token has made ${tokenEach()} requests this minute: try again in ${wait} seconds.`;
  return { wait, refusal };
}

/**
 * How much of each limit a workspace uses, as its Limits card shows it: near from NEAR of it, over at all of it. Seats
 * are paid for to be filled: they are over only past the limit, and a limit of one seat is never near it.
 */
export function useOf(limits: Limits, used: Record<LimitName, number>) {
  return LIMITS.filter((name) => limits[name]).map((name) => {
    const most = limits[name]!, n = used[name], seats = name === 'members';
    return { name, used: n, most, shown: name === 'storage' ? bytes(n) : String(n), of: UNIT[name](most), near: n >= most * NEAR && !(seats && most === 1), over: seats ? n > most : n >= most };
  });
}
