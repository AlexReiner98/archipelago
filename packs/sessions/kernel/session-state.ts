// A run's state and line, worked out from what it did (docs/sessions.md, "Wired: what the server gives"): its events
// (the sessions stream, src/session-events.ts), its turns (core's turnsOf) and its state (core's stateOf), with its
// latest beat from its story, the title of what it works on, whether that waits on an open depends_on, and how long
// an open run may be silent before it is quiet (the house style's `quiet_after`). Every read is by the runs' ids, and
// many runs take as many reads as one.

import type { Archipelago } from '../../../src/pelago.ts';
import { openOps } from '../../../src/opseal.ts';
import { isSealed } from '../../../src/seal.ts';
import type { Light, OpFact } from '../../../src/streams.ts';
import type { SessionEvent } from './session-events.ts';
import { pageStyle } from '../../../src/styles.ts';
// @ts-ignore: core's pack code is plain JavaScript, typed by its use here.
import { turnsOf as turnsOfJs } from '../../core/sessions/turns.js';
// @ts-ignore: as above.
import { stateOf as stateOfJs } from '../../core/sessions/states.js';

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

/** The field an event is kept under on its run, as src/session-events.ts keeps it (its EVENT_FIELD: importing it would
 * close a ring through src/sessions.ts and src/views.ts). */
const EVENT_FIELD = 'event';

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
async function numbersOf(l: Archipelago): Promise<{ quiet_after?: number }> {
  const numbers = (await pageStyle(l, {}, false).catch(() => undefined))?.style.numbers as Record<string, unknown> | undefined;
  return typeof numbers?.quiet_after === 'number' ? { quiet_after: numbers.quiet_after } : {};
}

type RunRow = { id: string; status: string; is_open: boolean; created_at: Date; updated_at: Date; story: unknown; last_seen: string | null; busy: boolean | null };
type Row = { stream: Light['stream']; pos: number; at: Date; head: Omit<Light, 'stream' | 'pos' | 'at' | 'facts'>; facts: OpFact[] };

/** The events of many runs, in one read of the sessions stream from the earliest run's start: by run, each in order. */
async function eventsOf(l: Archipelago, runs: RunRow[]): Promise<Map<string, SessionEvent[]>> {
  const out = new Map<string, SessionEvent[]>(runs.map((r) => [r.id, []]));
  if (!runs.length) return out;
  const since = new Date(Math.min(...runs.map((r) => r.created_at.getTime())));
  // Each entry's facts are read once and matched by run, not tested against every run in turn: a test of the whole
  // facts per run opened them again each time, and a busy workspace's few thousand entries took seconds.
  const { rows } = await l.db.query<Row>(
    `select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1
     and exists (select 1 from jsonb_array_elements(facts) f where f->>0 = '+' and f->>2 = $3 and f->>1 = any($2::text[])) order by at, pos`,
    [since.toISOString(), runs.map((r) => r.id), EVENT_FIELD],
  );
  const opened = await openOps(l.db, rows.map((r): Light => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
  for (const e of opened)
    for (const f of e.facts)
      // An event whose key is gone (its run forgotten) reads as a digest, and is no event any more.
      if (f[0] === '+' && f[2] === EVENT_FIELD && out.has(f[1]) && !isSealed(f[3]) && typeof (f[3] as SessionEvent)?.kind === 'string') out.get(f[1])!.push(f[3] as SessionEvent);
  // Stable: what came at the same time stays in the order it was sent.
  for (const list of out.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out;
}

/** Its latest beat that stands (none taken back), from its story: its own words, never what a rule asked of it (`asked`). */
const beatOf = (story: unknown) => (Array.isArray(story) ? (story as { said?: string; replaced_by?: number; asked?: string }[]).findLast((b) => b && b.replaced_by === undefined && !b.asked && typeof b.said === 'string') : undefined);

/** The states of many runs, by run id: a run not found is left out. */
export async function sessionStates(l: Archipelago, runs: string[], now: string = new Date().toISOString()): Promise<Map<string, SessionState>> {
  const ids = [...new Set(runs)];
  if (!ids.length) return new Map();
  const { rows } = await l.db.query<RunRow>(
    `select id, status, is_open, created_at, updated_at, props->'story' as story, props->>'last_seen' as last_seen, (props->>'busy')::boolean as busy from entity where id = any($1::text[])`,
    [ids],
  );
  // What each works on, newest first, and whether that waits on work still open.
  const { rows: on } = await l.db.query<{ run: string; title: string; since: Date | null }>(
    `select r.from_id as run, e.title,
            (select max(d.valid_from) from relation d join entity t on t.id = d.to_id
              where d.from_id = e.id and d.valid_to is null and d.type = any($3::text[]) and t.is_open) as since
     from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.valid_to is null and r.type = any($2::text[]) order by r.valid_from desc`,
    [ids, l.registry.relationFamily('works_on'), l.registry.relationFamily('depends_on')],
  );
  const [events, numbers] = await Promise.all([eventsOf(l, rows), numbersOf(l)]);
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
export async function sessionState(l: Archipelago, run: string, now?: string): Promise<SessionState | undefined> {
  return (await sessionStates(l, [run], now)).get(run);
}
