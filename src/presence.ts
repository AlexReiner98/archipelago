// Where agents have pointed the owner's screen, and the steps they took, kept where any server can read them: in the
// workspace's transient table (src/transient.ts), so a page that polls one server follows a show made on another. A
// show, a change and a told beat are kept at once, as they come with a write of their own; the steps of read tools
// are gathered in this process and kept at most once a FLUSH_MS, so reading the map costs no write per call. A page
// asking this process sees its own steps as they are taken, and another server's within FLUSH_MS. The agents waiting in
// watch are counted per process, kept for LISTEN_MS and kept again while they wait, and summed: a server that stops
// stops counting within LISTEN_MS.

import { randomBytes } from 'node:crypto';
import type { Q } from './db.ts';
import { keep } from './transient.ts';

/** Where an agent last pointed the human's screen: a place in the web UI. */
export interface Focus {
  /** When it was set; a new value is how the UI knows to move. */
  at: number;
  /** The UI address without its "#/", e.g. "e/e_abc" or "roadmap/e_abc". */
  hash: string;
  actor: string;
  note?: string;
}

/**
 * One thing an agent did through a tool, whatever it was. The page is given
 * the last few and follows those the person has chosen to: by what kind of
 * step it is, and by whose it is.
 */
export interface Step {
  /** Counts up: a higher number is how the page knows a step is new. */
  at: number;
  /** show: it pointed the page. change: it changed the map. story: it told a beat of its session's story. read: one item. view: a standing question or a picture. search. other: sessions, resources and the rest. */
  kind: 'show' | 'change' | 'story' | 'read' | 'view' | 'search' | 'other';
  actor: string;
  /** What it did, in a few words; for a show or a change, the note or the reason it gave. */
  did?: string;
  /** The UI address of what it did it to, when that is one item or one picture. */
  hash?: string;
}

/** How many steps are kept for a page to catch up on between two looks. */
export const STEPS_KEPT = 12;
/** How long a read step may wait in this process before another server can see it. */
export const FLUSH_MS = 1000;
/** Where to look means nothing after a day. */
const KEPT_MS = 24 * 3600_000;
/** This process, among the servers sharing a database. */
const PROCESS = randomBytes(4).toString('hex');

/** How long a server's count of agents listening holds unless it is kept again. */
export const LISTEN_MS = 15_000;

/** Whose screen: per workspace and per person. */
export type Whose = { workspace: string; viewer?: string };
const whose = (w: Whose) => `${w.workspace}:${w.viewer ?? ''}`;

// This process's own steps, per screen, and those not yet kept.
const mine = new Map<string, Step[]>();
const unkept = new Map<string, Q>();
let timer: NodeJS.Timeout | undefined;

/** Point the screen there. */
export async function point(db: Q, w: Whose, focus: Focus): Promise<void> {
  await keep(db, `focus:${whose(w)}`, focus, KEPT_MS);
}

/** A step taken: kept at once when `now`, else with the next flush. */
export async function took(db: Q, w: Whose, step: Omit<Step, 'at'>, now = false): Promise<void> {
  const key = whose(w);
  const list = mine.get(key) ?? [];
  // Two steps in one millisecond are still two.
  list.push({ at: Math.max(Date.now(), (list.at(-1)?.at ?? 0) + 1), ...step });
  mine.set(key, list.slice(-STEPS_KEPT));
  unkept.set(key, db);
  if (now) return flush(key);
  timer ??= setTimeout(() => void flushAll().catch(() => {}), FLUSH_MS).unref();
}

async function flush(key: string): Promise<void> {
  const db = unkept.get(key);
  if (!db) return;
  unkept.delete(key);
  await keep(db, `steps:${key}:${PROCESS}`, mine.get(key) ?? [], KEPT_MS);
}

/** Keep every step not yet kept. */
export async function flushAll(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  await Promise.all([...unkept.keys()].map(flush));
}

// The agents waiting in watch on this process, per workspace.
const waiting = new Map<string, { db: Q; count: number }>();
let beat: NodeJS.Timeout | undefined;
const keepWaiting = (workspace: string, w: { db: Q; count: number }) => keep(w.db, `listening:${workspace}:${PROCESS}`, w.count, LISTEN_MS);

/** An agent begins (1) or stops (-1) waiting in watch on this process. */
export async function listening(db: Q, workspace: string, by: 1 | -1): Promise<void> {
  const w = waiting.get(workspace) ?? { db, count: 0 };
  w.count += by;
  if (w.count > 0) waiting.set(workspace, w);
  else waiting.delete(workspace);
  if (waiting.size) beat ??= setInterval(() => void Promise.all([...waiting].map(([ws, w]) => keepWaiting(ws, w))).catch(() => {}), LISTEN_MS / 3).unref();
  else {
    clearInterval(beat);
    beat = undefined;
  }
  await keepWaiting(workspace, w);
}

/** A beat told in a workspace: the stamp a page watches moves with it. */
export async function tellStamp(db: Q, workspace: string): Promise<void> {
  await keep(db, `told:${workspace}`, Date.now(), KEPT_MS);
}

/** What a page polling for this screen is given: where it was pointed, the last steps on any server, the tell stamp and how many agents are listening. */
export async function presence(db: Q, w: Whose): Promise<{ focus?: Focus; steps: Step[]; told: number; listening: number }> {
  const key = whose(w);
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `select key, value from transient where until >= now() and (key = $1 or key = $2 or (starts_with(key, $3) and key <> $4) or (starts_with(key, $5) and key <> $6))`,
    [`focus:${key}`, `told:${w.workspace}`, `steps:${key}:`, `steps:${key}:${PROCESS}`, `listening:${w.workspace}:`, `listening:${w.workspace}:${PROCESS}`],
  );
  const value = (k: string) => rows.find((r) => r.key === k)?.value;
  const theirs = rows.filter((r) => r.key.startsWith('steps:')).flatMap((r) => r.value as Step[]);
  const steps = [...theirs, ...(mine.get(key) ?? [])].sort((a, b) => a.at - b.at).slice(-STEPS_KEPT);
  const listeners = rows.filter((r) => r.key.startsWith('listening:')).reduce((sum, r) => sum + Number(r.value), waiting.get(w.workspace)?.count ?? 0);
  return { focus: value(`focus:${key}`) as Focus | undefined, steps, told: (value(`told:${w.workspace}`) as number | undefined) ?? 0, listening: listeners };
}
