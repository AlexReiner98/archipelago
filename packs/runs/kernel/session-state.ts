// A run's state and line, worked out from what it did (docs/sessions.md, "Wired: what the server gives"): its events
// (the sessions stream, packs/sessions/kernel/session-events.ts), its turns (core's turnsOf) and its state (core's stateOf), with its
// latest beat from its story, the title of what it works on, whether that waits on an open depends_on, and how long
// an open run may be silent before it is quiet (the house style's `quiet_after`). Every read is by the runs' ids, and
// many runs take as many reads as one.

import type { KernelContext } from '#pelago/kernel';
// @ts-ignore: core's pack code, copied here, is plain JavaScript, typed by its use here.
import { turnsOf as turnsOfJs } from './turns.js';
// @ts-ignore: as above.
import { stateOf as stateOfJs } from './states.js';

/** One event as the sessions stream keeps it (the sessions pack's SessionEvent): the part read here. */
export interface SessionEvent {
  at: string;
  kind: string;
  turn?: string;
  [field: string]: unknown;
}

/** A turn as docs/sessions.md has it ("A turn"). */
export interface Turn {
  turn: string;
  began: string;
  ended?: string;
  end?: string;
  question?: string;
  waits: { for: string | null; began: string; ended?: string }[];
  [field: string]: unknown;
}

/** A run's state, as the sessions view and the flat answer carry it. */
export interface SessionMark {
  state: string;
  for?: string;
  line: string;
  since: string | null;
}

/** A run's state with its latest turn and how many it has had. */
export interface SessionState extends SessionMark {
  turn?: Turn;
  turns: number;
}

const turnsOf = turnsOfJs as (events: SessionEvent[]) => Turn[];
const stateOf = stateOfJs as (input: Record<string, unknown>) => SessionMark;

/** The states in the order they ask for attention: what waits on a person first. */
export const ATTENTION = ['waiting', 'your_move', 'blocked', 'quiet', 'working', 'idle', 'done'];

/** Of a state: the mark the sessions view and the flat answer carry, without its turns. */
export const markOf = ({ state, for: f, line, since }: SessionState): SessionMark => ({ state, ...(f && { for: f }), line, since });

/** Orders runs by their states' attention, each state's oldest `since` first. */
export function byAttention(a: SessionMark, b: SessionMark): number {
  const rank = (s: SessionMark) => (ATTENTION.includes(s.state) ? ATTENTION.indexOf(s.state) : ATTENTION.length);
  const when = (s: SessionMark) => (s.since ? Date.parse(s.since) : Infinity);
  return rank(a) - rank(b) || when(a) - when(b);
}

/** The house style's numbers a run's state is worked out by, in minutes. */
async function numbersOf(ctx: KernelContext): Promise<{ quiet_after?: number }> {
  const numbers = (await ctx.call<unknown, { style: Record<string, unknown> }>('answer.view_style', {}).catch(() => undefined))?.style.numbers as Record<string, unknown> | undefined;
  return typeof numbers?.quiet_after === 'number' ? { quiet_after: numbers.quiet_after } : {};
}

type RunRow = { id: string; status: string; is_open: boolean; created_at: Date; updated_at: Date; story: unknown; last_seen: string | null; busy: boolean | null };

/** The events of many runs, in one read of the sessions stream from the earliest run's start: by run, each in order. */
async function eventsOf(ctx: KernelContext, runs: RunRow[]): Promise<Map<string, SessionEvent[]>> {
  if (!runs.length) return new Map();
  const since = new Date(Math.min(...runs.map((r) => r.created_at.getTime())));
  // Each entry's facts are read once and matched by run, not tested against every run in turn: a test of the whole
  // facts per run opened them again each time, and a busy workspace's few thousand entries took seconds.
  const read = (await ctx.reads({ run_events: { runs: runs.map((r) => r.id), since: since.toISOString() } })) as Record<string, SessionEvent[]>;
  return new Map(runs.map((r) => [r.id, read[r.id] ?? []]));
}

/** Its latest beat that stands (none taken back), from its story: its own words, never what a rule asked of it (`asked`). */
const beatOf = (story: unknown) => (Array.isArray(story) ? (story as { said?: string; replaced_by?: number; asked?: string }[]).findLast((b) => b && b.replaced_by === undefined && !b.asked && typeof b.said === 'string') : undefined);

/** The states of many runs, by run id: a run not found is left out. */
export async function sessionStates(ctx: KernelContext, runs: string[], now: string = ctx.now().toISOString()): Promise<Map<string, SessionState>> {
  const ids = [...new Set(runs)];
  if (!ids.length) return new Map();
  const rows = (await ctx.reads({ run_rows: ids })) as RunRow[];
  // What each works on, newest first, and whether that waits on work still open.
  const on = (await ctx.reads({ run_works: { ids, works_on: ctx.registry.relationFamily('works_on'), depends_on: ctx.registry.relationFamily('depends_on') } })) as { run: string; title: string; since: Date | null }[];
  const [events, numbers] = await Promise.all([eventsOf(ctx, rows), numbersOf(ctx)]);
  const out = new Map<string, SessionState>();
  for (const r of rows) {
    const list = events.get(r.id) ?? [];
    const turns = turnsOf(list);
    const works = on.filter((w) => w.run === r.id);
    const blocked = works.find((w) => w.since);
    const last = [list.at(-1)?.at, r.last_seen ?? undefined].filter(Boolean).sort().at(-1);
    const mark = stateOf({
      run: { open: r.is_open, status: r.status, started: r.created_at.toISOString(), busy: r.busy === true, ...(!r.is_open && { ended: r.updated_at.toISOString() }) },
      turns,
      ...(blocked && { blocked: { since: blocked.since!.toISOString() } }),
      ...(beatOf(r.story) && { beat: beatOf(r.story) }),
      ...(works[0] && { title: works[0].title }),
      ...(last && { last }),
      now,
      ...numbers,
    });
    out.set(r.id, { ...mark, ...(turns.length && { turn: turns.at(-1) }), turns: turns.length });
  }
  return out;
}

/** The state of one run, or undefined when there is no such run. */
export async function sessionState(ctx: KernelContext, run: string, now?: string): Promise<SessionState | undefined> {
  return (await sessionStates(ctx, [run], now)).get(run);
}
