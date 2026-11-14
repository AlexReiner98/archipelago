// Where agents have pointed the owner's screen, and the steps they took, kept where any server can read them: in the
// workspace's transient table (root.transient, packs/surface), so a page that polls one server follows a show made on another. A
// show, a change and a told beat are kept at once, as they come with a write of their own; the steps of read tools
// are gathered in this process and kept at most once a FLUSH_MS, so reading the map costs no write per call. A page
// asking this process sees its own steps as they are taken, and another server's within FLUSH_MS. The agents waiting in
// watch are counted per process, kept for LISTEN_MS and kept again while they wait, and summed: a server that stops
// stops counting within LISTEN_MS. The pages open on a screen, and whether each takes shows, are kept the same way, so a
// show can say whether it landed.

import { randomBytes } from 'node:crypto';
import type { KernelContext } from '#pelago/kernel';
import { keep, scan } from './store.ts';

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
 * the last few: a show lands on it, and the rest say which sessions are at work.
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
  /** For a show: the pane of the owner's page it goes to (ui/panes.js): a side of the main canvas, the main one, the main one alone, or a pane of the session's own by the name it gives. */
  pane?: string;
  /** For a show (true unless the agent sent focus: false): their page brings its tab into sight (ui/pane-route.js). */
  focus?: boolean;
  /** For a show: the session has just begun, and the owner's page opens it a tab of its own (ui/pane-route.js). */
  opens?: boolean;
  /** For a show the server takes for a session: its pane draws the item's canvas, and no page opens over it. */
  canvas?: boolean;
  /** With opens: the session whose chat this one goes on (after a clear), whose tab it takes over. */
  takes?: string;
  /** The session has ended: the owner's page closes its tab (ui/tab-life.js). */
  ends?: boolean;
  /** The session has gone quiet, or said where its work stands and waits: the owner's page lets its tab go until it next shows something. */
  rests?: boolean;
  /** The session it was taken in, as the agent said it or last said it: a pane can follow one session. */
  run?: string;
  /** That session's word, never shown: the key to its hue (packs/sessions/kernel/session-name.ts). */
  name?: string;
  /** What its chat is called, read at each step so a rename reaches every page. */
  title?: string;
  /** What its surface calls it (its title in Claude Code), when that is known. */
  label?: string;
  /** What the session works on and everything that holds it, all the way up: a tab watching any of them takes its shows (ui/pane-route.js). */
  within?: string[];
  /** For a show: the owner approved what it shows, and the tab it lands in watches it from now on (ui/pane-land.js). */
  watch?: boolean;
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
export const whose = (w: Whose) => `${w.workspace}:${w.viewer ?? ''}`;

// Each map this process holds, by its registry (made once as it opens): two maps of one workspace in one process (a
// test's map beside one a server opened) are two screens' worth of steps, never one.
const maps = new WeakMap<object, number>();
let mapsHeld = 0;
const mapOf = (ctx: KernelContext) => {
  const map: object = ctx.registry ?? ctx;
  return maps.get(map) ?? (maps.set(map, ++mapsHeld), mapsHeld);
};
/** A screen of one map, as this process keeps its own steps. */
const screenOf = (ctx: KernelContext, w: Whose) => `${mapOf(ctx)}|${whose(w)}`;

// This process's own steps, per screen of each map, and those not yet kept (with the screen they are kept under).
const mine = new Map<string, Step[]>();
// The session each agent last named on this screen, for its steps that name none (a change, a read): sessions of one
// agent that each give a name of their own are told apart; two that go by one name are as one, but for what they name.
const runs = new Map<string, string>();
const unkept = new Map<string, { ctx: KernelContext; at: string }>();
let timer: NodeJS.Timeout | undefined;

/** Point the screen there. */
export async function point(ctx: KernelContext, w: Whose, focus: Focus): Promise<void> {
  await keep(ctx, `focus:${whose(w)}`, focus, KEPT_MS);
}

/** A step taken: kept at once when `now`, else with the next flush. */
export async function took(ctx: KernelContext, w: Whose, step: Omit<Step, 'at'>, now = false): Promise<void> {
  const key = screenOf(ctx, w);
  const named = `${key}|${step.actor}`;
  if (step.run) runs.set(named, step.run);
  const run = step.run ?? runs.get(named);
  const called = run ? { ...(await namesOf(ctx, run)), ...(await withinOf(ctx, run)) } : {};
  const list = mine.get(key) ?? [];
  // Two steps in one millisecond are still two.
  list.push({ at: Math.max(Date.now(), (list.at(-1)?.at ?? 0) + 1), ...step, ...(run && { run }), ...called });
  mine.set(key, list.slice(-STEPS_KEPT));
  unkept.set(key, { ctx, at: whose(w) });
  if (now) return flush(key);
  timer ??= setTimeout(() => void flushAll().catch(() => {}), FLUSH_MS).unref();
}

/** The session an agent last named on this screen, for a step of its that names none. */
export const runNamed = (ctx: KernelContext, w: Whose, actor: string) => runs.get(`${screenOf(ctx, w)}|${actor}`);

/** A session's word and what its chat is called, which may change while it runs: read each time, by its id. */
async function namesOf(ctx: KernelContext, run: string): Promise<{ name?: string; title?: string; label?: string }> {
  type Row = { title?: string | null; props?: Record<string, unknown> | null };
  const rows = ((await ctx.reads({ ids: [run] }).catch(() => [])) ?? []) as Row[];
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const name = text(rows[0]?.props?.name), title = text(rows[0]?.title), label = text(rows[0]?.props?.label);
  return { ...(name && { name }), ...(title && { title }), ...(label && { label }) };
}

/**
 * What session `run` works on now and what holds each of those, read by its id through the part_of closure, so the
 * owner's page can tell a session working inside a plan it watches.
 */
async function withinOf(ctx: KernelContext, run: string): Promise<{ within?: string[] }> {
  const ids = ((await ctx.reads({ run_within: run }).catch(() => [])) ?? []) as string[];
  return ids.length ? { within: ids } : {};
}

async function flush(key: string): Promise<void> {
  const un = unkept.get(key);
  if (!un) return;
  unkept.delete(key);
  await keep(un.ctx, `steps:${un.at}:${PROCESS}`, mine.get(key) ?? [], KEPT_MS);
}

/** Keep every step not yet kept. */
export async function flushAll(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  await Promise.all([...unkept.keys()].map(flush));
}

// The agents waiting in watch on this process, per workspace.
const waiting = new Map<string, { ctx: KernelContext; count: number }>();
let beat: NodeJS.Timeout | undefined;
const keepWaiting = (workspace: string, w: { ctx: KernelContext; count: number }) => keep(w.ctx, `listening:${workspace}:${PROCESS}`, w.count, LISTEN_MS);

/** An agent begins (1) or stops (-1) waiting in watch on this process. */
export async function listening(ctx: KernelContext, by: 1 | -1): Promise<void> {
  const workspace = ctx.workspace;
  const w = waiting.get(workspace) ?? { ctx, count: 0 };
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
export async function tellStamp(ctx: KernelContext): Promise<void> {
  await keep(ctx, `told:${ctx.workspace}`, Date.now(), KEPT_MS);
}

/** How long a page counts as open after it last looked: it looks every two seconds while it is in sight. */
export const PAGE_MS = 10_000;
/** An open page, and whether a show can land in it (`on`: a tab of it follows someone). */
export interface Page {
  page: string;
  on: boolean;
  at: number;
}
// The pages that looked at this process, per screen of each map, and when they were last kept for the other servers.
const pages = new Map<string, Map<string, Page>>();
const pagesKept = new Map<string, { value: string; at: number }>();
const openNow = (key: string) => [...(pages.get(key)?.values() ?? [])].filter((p) => Date.now() - p.at < PAGE_MS);

/** A page looked: kept for the other servers only when whether it takes shows changed, or before the last keeping runs out. */
export async function looked(ctx: KernelContext, w: Whose, page: Omit<Page, 'at'>): Promise<void> {
  const key = screenOf(ctx, w);
  const list = pages.get(key) ?? new Map<string, Page>();
  list.set(page.page, { ...page, at: Date.now() });
  pages.set(key, list);
  const open = openNow(key);
  for (const id of list.keys()) if (!open.some((p) => p.page === id)) list.delete(id);
  const value = JSON.stringify(open.map(({ page, on }) => [page, on]));
  const last = pagesKept.get(key);
  if (last?.value === value && Date.now() - last.at < PAGE_MS / 2) return;
  pagesKept.set(key, { value, at: Date.now() });
  await keep(ctx, `pages:${whose(w)}:${PROCESS}`, open, PAGE_MS);
}

/** The pages open on this screen, on any server, and how many of them take a show. */
export async function watching(ctx: KernelContext, w: Whose): Promise<{ open: number; following: number }> {
  const key = whose(w);
  const rows = (await scan(ctx, [], [`pages:${key}:`], [`pages:${key}:${PROCESS}`])) as { value: Page[] }[];
  // Another server's pages are as it last kept them, for as long as that keeping lasts.
  const open = [...rows.flatMap((r) => r.value), ...openNow(screenOf(ctx, w))];
  return { open: open.length, following: open.filter((p) => p.on).length };
}

/** What a page polling for this screen is given: where it was pointed, the last steps on any server, the tell stamp and how many agents are listening. */
export async function presence(ctx: KernelContext, w: Whose): Promise<{ focus?: Focus; steps: Step[]; told: number; listening: number }> {
  const key = whose(w);
  const rows = await scan(ctx, [`focus:${key}`, `told:${w.workspace}`], [`steps:${key}:`, `listening:${w.workspace}:`], [`steps:${key}:${PROCESS}`, `listening:${w.workspace}:${PROCESS}`]);
  const value = (k: string) => rows.find((r) => r.key === k)?.value;
  const theirs = rows.filter((r) => r.key.startsWith('steps:')).flatMap((r) => r.value as Step[]);
  const steps = [...theirs, ...(mine.get(screenOf(ctx, w)) ?? [])].sort((a, b) => a.at - b.at).slice(-STEPS_KEPT);
  const listeners = rows.filter((r) => r.key.startsWith('listening:')).reduce((sum, r) => sum + Number(r.value), waiting.get(w.workspace)?.count ?? 0);
  return { focus: value(`focus:${key}`) as Focus | undefined, steps, told: (value(`told:${w.workspace}`) as number | undefined) ?? 0, listening: listeners };
}
