// What turns tell over a time range (docs/sessions.md, task 11): which sessions wait on their person now and since
// when, how many turns and tokens each item worked on took, and which sessions have gone an hour of turns with no test
// passing and no commit. Read from the events the sessions stream kept in the range (one read, bounded by its time),
// the runs they are about and what each worked on (by those runs' ids), and worked out with the same `turnsOf` the
// session's page uses.

import { type Archipelago } from '../../../src/pelago.ts';
import { openOps } from '../../../src/opseal.ts';
import { isSealed } from '../../../src/seal.ts';
import type { Light, OpFact } from '../../../src/streams.ts';
import { EVENT_FIELD, type SessionEvent } from './session-events.ts';
// @ts-ignore: a pack's plain module, typed by its use here (Turn below)
import { turnsOf } from '../../core/sessions/turns.js';

/** A turn as `turnsOf` works it out (docs/sessions.md, "A turn"): the part read here. */
interface Turn {
  turn: string;
  began: string;
  ended?: string;
  end?: string;
  question?: string;
  tests: { runs: number; ok: number; failed: number };
  commits: string[];
  waits: { for: string | null; began: string; ended?: string; gist?: string }[];
  tokens?: Partial<Record<'input' | 'output' | 'cache_read' | 'cache_write', number>>;
}

const WEEK = 7 * 86_400_000;
/** The most stream entries one range reads: past it, the newest are read and the answer says so. */
const ENTRIES = 20_000;
/** Minutes of turns with no passing test and no commit before a session is called stalled. */
const STALL_MINUTES = 60;

type Row = { stream: Light['stream']; pos: number; at: Date; head: Omit<Light, 'stream' | 'pos' | 'at' | 'facts'>; facts: OpFact[] };

/** The events kept in a range, by run: the entries recorded since its start (an event is recorded after it happens). */
async function eventsIn(l: Archipelago, since: Date, until: Date) {
  const { rows } = await l.db.query<Row>(
    `select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1 and at < $2
     order by at desc, pos desc limit ${ENTRIES + 1}`,
    [since.toISOString(), new Date(until.getTime() + 60_000).toISOString()],
  );
  const more = rows.length > ENTRIES;
  const mine = rows.slice(0, ENTRIES).filter((r) => r.facts.some((f) => f[0] === '+' && f[2] === EVENT_FIELD)).reverse();
  const opened = await openOps(l.db, mine.map((r): Light => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
  const byRun = new Map<string, SessionEvent[]>();
  for (const e of opened) for (const f of e.facts) {
    const ev = f[3] as SessionEvent;
    if (f[0] !== '+' || f[2] !== EVENT_FIELD || isSealed(ev) || typeof ev?.kind !== 'string') continue;
    const t = Date.parse(ev.at);
    if (t < since.getTime() || t > until.getTime()) continue;
    const list = byRun.get(f[1]) ?? byRun.set(f[1], []).get(f[1])!;
    list.push(ev);
  }
  for (const list of byRun.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { byRun, more };
}

const minutes = (from: string | number, to: number) => Math.max(0, Math.round((to - (typeof from === 'number' ? from : Date.parse(from))) / 60_000));
const tokensOf = (t: Turn) => ({ input: t.tokens?.input ?? 0, output: t.tokens?.output ?? 0 });

/** What waits on a person now: an open run whose latest turn ended asked, or which waits on its client. */
function waitOf(turns: Turn[], now: number): { for: string; since: string; minutes: number; gist?: string; question?: string } | undefined {
  const last = turns.at(-1);
  if (!last) return undefined;
  const open = last.waits.findLast((w) => !w.ended);
  if (open) return { for: open.for ?? 'input', since: open.began, minutes: minutes(open.began, now), ...(open.gist && { gist: open.gist }) };
  if (last.end === 'asked' && last.ended) return { for: 'answer', since: last.ended, minutes: minutes(last.ended, now), ...(last.question && { question: last.question }) };
  return undefined;
}

/** Minutes of turns since the run last moved (a test passed or a commit made), and when it last did. */
function stallOf(turns: Turn[], now: number) {
  let from = 0;
  turns.forEach((t, i) => { if (t.tests.ok > 0 || t.commits.length) from = i + 1; });
  const since = turns.slice(from);
  const worked = since.reduce((sum, t) => sum + minutes(t.began, t.ended ? Date.parse(t.ended) : now), 0);
  return { worked, turns: since.length, moved: from ? (turns[from - 1].ended ?? turns[from - 1].began) : null };
}

export interface MeasuresInput {
  since?: string;
  until?: string;
  stall_minutes?: number;
}

/**
 * The three answers over a range (a week to now unless said): `waiting`, the open runs waiting on their person, oldest
 * first; `per_item`, turns and tokens by the item each run worked on during the turn, most turns first (a turn of a
 * run that worked on nothing is counted under the run); `stalled`, open runs with `stall_minutes` of turns or more
 * since a test last passed or a commit was made, longest first.
 */
export async function sessionMeasures(l: Archipelago, input: MeasuresInput = {}) {
  const until = input.until && !Number.isNaN(Date.parse(input.until)) ? new Date(input.until) : new Date();
  const since = input.since && !Number.isNaN(Date.parse(input.since)) ? new Date(input.since) : new Date(until.getTime() - WEEK);
  const stallAfter = typeof input.stall_minutes === 'number' && input.stall_minutes > 0 ? input.stall_minutes : STALL_MINUTES;
  const now = until.getTime();
  const { byRun, more } = await eventsIn(l, since, until);
  const ids = [...byRun.keys()];
  const { rows: runs } = await l.db.query<{ id: string; title: string; is_open: boolean }>(
    `select id, title, is_open from entity where id = any($1::text[]) and archived_at is null`,
    [ids],
  );
  const { rows: links } = await l.db.query<{ run: string; item: string; title: string; type: string; valid_from: Date; valid_to: Date | null }>(
    `select r.from_id as run, r.to_id as item, e.title, e.type, r.valid_from, r.valid_to from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.type = any($2::text[])`,
    [ids, l.registry.relationFamily('works_on')],
  );
  const waiting = [], stalled = [];
  const items = new Map<string, { id: string; title: string; type: string; turns: number; tokens: { input: number; output: number }; runs: Set<string> }>();
  for (const run of runs) {
    const turns = (turnsOf(byRun.get(run.id)) as Turn[]);
    const head = { run: run.id, title: run.title };
    for (const t of turns) {
      const at = Date.parse(t.began);
      if (at < since.getTime()) continue;
      // What it worked on during the turn; else what it named next (the turns before a session names its task are
      // that task's); else the run itself.
      const end = t.ended ? Date.parse(t.ended) : now;
      const its = links.filter((x) => x.run === run.id);
      const during = its.filter((x) => x.valid_from.getTime() <= end && (!x.valid_to || x.valid_to.getTime() > at));
      const next = its.filter((x) => x.valid_from.getTime() > end).sort((x, y) => x.valid_from.getTime() - y.valid_from.getTime()).slice(0, 1);
      const on = during.length ? during : next;
      for (const it of on.length ? on : [{ item: run.id, title: run.title, type: 'run' }]) {
        const m = items.get(it.item) ?? items.set(it.item, { id: it.item, title: it.title, type: it.type, turns: 0, tokens: { input: 0, output: 0 }, runs: new Set() }).get(it.item)!;
        const tk = tokensOf(t);
        m.turns++; m.tokens.input += tk.input; m.tokens.output += tk.output; m.runs.add(run.id);
      }
    }
    if (!run.is_open) continue;
    const wait = waitOf(turns, now);
    if (wait) waiting.push({ ...head, ...wait });
    const stall = stallOf(turns, now);
    if (stall.worked >= stallAfter) stalled.push({ ...head, minutes: stall.worked, turns: stall.turns, moved: stall.moved });
  }
  waiting.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  stalled.sort((a, b) => b.minutes - a.minutes);
  const per_item = [...items.values()].map(({ runs: r, ...m }) => ({ ...m, runs: r.size })).sort((a, b) => b.turns - a.turns || (b.tokens.input + b.tokens.output) - (a.tokens.input + a.tokens.output));
  return {
    since: since.toISOString(),
    until: until.toISOString(),
    stall_minutes: stallAfter,
    waiting,
    per_item,
    stalled,
    ...(more && { more: `Only the newest ${ENTRIES} entries of the sessions stream were read: ask a shorter range.` }),
  };
}
