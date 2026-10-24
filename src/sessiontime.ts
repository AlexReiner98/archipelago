// When a session was at work, for the time axis: the stretches its turns recorded (or, for one from before they
// were kept, its signs of work gathered where they fall close together), cut where it moved from one piece of work
// to another. Each span says what it was on: the work it had taken up, else the place it ran in. A session that was
// only reported once it was over (a push read in GitHub Actions) has no length: it is one span that starts as it ends.

import type { Archipelago } from './pelago.ts';
import { livesIn } from './places.ts';

/** A session closed this long after it was last heard from was ended for it: it stopped when it went quiet. */
const QUIET_MS = 3_600_000;
/** Signs of work further apart than this, in a session recorded before its stretches were kept, are taken as idle between. */
const GUESS_GAP_MS = 45 * 60_000;
/** A lone sign of work, with nothing near it, is drawn as this much work. */
const LONE_MS = 5 * 60_000;

export interface Run {
  id: string;
  is_open: boolean;
  props: Record<string, unknown>;
  created_at: Date;
  updated_at?: Date;
}

export interface RunSpan {
  start: string;
  end: string;
  by: 'when';
  /** The work it was on then, or the place it ran in when it was on nothing in particular. */
  on: string | null;
}

/** When a session was at work, from its signs of work between two moments, gathered where they fall close together. */
function guessed(p: Record<string, unknown>, began: number, ended: number, events: number[]): [number, number][] {
  const beats = (Array.isArray(p.story) ? p.story : []).map((b) => Date.parse(b?.at)).filter(Number.isFinite);
  const seen = Date.parse(String(p.last_seen ?? ''));
  const points = [began, ended, ...events, ...beats, ...(Number.isFinite(seen) ? [seen] : [])].filter((t) => t >= began && t <= ended).sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (const t of points) {
    const last = spans.at(-1);
    if (last && t - last[1] <= GUESS_GAP_MS) last[1] = t;
    else spans.push([t, t]);
  }
  // A lone sign is a few minutes of work, inside the session: the moment it ended is the end of its last few minutes.
  return spans.map(([a, b]) => (b - a >= LONE_MS ? [a, b] : a + LONE_MS <= ended ? [a, a + LONE_MS] : [Math.max(began, ended - LONE_MS), ended]));
}

/** When a session was at work: the stretches its turns recorded (one still under way runs to now), else its signs of work. */
function activity(run: Run, began: number, ended: number, events: number[], now: number): [number, number][] {
  const p = run.props;
  const kept = (Array.isArray(p.active) ? p.active : []).filter((s) => Array.isArray(s) && s.length === 2).map(([a, b]) => [Date.parse(a), Date.parse(b)] as [number, number]).filter(([a, b]) => b >= a);
  if (kept.length) {
    const last = kept.at(-1)!;
    if (run.is_open && p.busy === true) last[1] = Math.max(last[1], now);
    // A session already under way when stretches began to be kept is guessed at up to its first one.
    const before = kept[0][0] - began > LONE_MS ? guessed(p, began, kept[0][0], events).filter(([, b]) => b < kept[0][0]) : [];
    // A turn with nothing heard between its start and end still took a moment.
    return [...before, ...kept.map(([a, b]) => [a, Math.max(b, a + 60_000)] as [number, number])];
  }
  return guessed(p, began, ended, events);
}

/** Where each session was at work between two instants, cut by the work it was on. */
export async function runSpans(l: Archipelago, runs: Run[], from: number, to: number, now = Date.now()): Promise<Map<string, RunSpan[]>> {
  const out = new Map<string, RunSpan[]>(runs.map((r) => [r.id, []]));
  // Only a session that began before the window ended and was heard from after it began can fall in it.
  const lastHeard = (r: Run) => Math.max(new Date(r.updated_at ?? r.created_at).getTime(), Date.parse(String(r.props.last_seen ?? '')) || 0, r.is_open ? now : 0);
  runs = runs.filter((r) => new Date(r.created_at).getTime() < to && lastHeard(r) >= from);
  if (!runs.length) return out;
  const ids = runs.map((r) => r.id);
  const { rows: tasks } = await l.db.query<{ run: string; task: string; valid_from: Date; valid_to: Date | null }>(
    `select from_id as run, to_id as task, valid_from, valid_to from relation where type = 'sys.works_on' and from_id = any($1::text[]) order by valid_from`,
    [ids],
  );
  const { rows: places } = await l.db.query<{ run: string; place: string }>(`select from_id as run, to_id as place from relation where from_id = any($1::text[]) and type = any($2::text[]) and valid_to is null`, [ids, livesIn(l)]);
  // What else says when a session recorded before its stretches were kept was at work: what it did to its own record.
  const { rows: signs } = await l.db.query<{ run: string; ts: Date }>(`select target_id as run, ts from event where target_id = any($1::text[])
     union all select f.id, e.at from log_fact f join log_entry e on e.stream = f.stream and e.at = f.at and e.pos = f.pos where f.stream = 'facts' and f.id = any($1::text[])`, [ids]);
  const iso = (t: number) => new Date(t).toISOString();
  for (const run of runs) {
    const spans = out.get(run.id)!;
    const place = places.find((p) => p.run === run.id)?.place ?? null;
    const began = new Date(run.created_at).getTime();
    // An open session runs until it was last heard from. One closed long after it went quiet (ended for it) stopped
    // then too; one that ended itself stopped when it ended.
    const seen = Date.parse(String(run.props.last_seen ?? '')) || 0;
    const closed = new Date(run.updated_at ?? run.created_at).getTime();
    const ended = Math.max(began, run.is_open ? Math.max(seen, closed) : seen && closed - seen > QUIET_MS ? seen : closed);
    if (ended - began < 1000) {
      if (began >= from && began < to) spans.push({ start: iso(began), end: iso(began), by: 'when', on: place });
      continue;
    }
    if (ended < from || began >= to) continue;
    // Each piece of work holds from when it was taken up until the next one was, or until it was let go.
    const mine = tasks.filter((t) => t.run === run.id);
    const pieces: { a: number; b: number; on: string | null }[] = [];
    let cursor = began;
    mine.forEach((t, i) => {
      const a = Math.min(Math.max(new Date(t.valid_from).getTime(), cursor), ended);
      const next = mine[i + 1] ? new Date(mine[i + 1].valid_from).getTime() : ended;
      const b = Math.min(t.valid_to ? new Date(t.valid_to).getTime() : ended, next, ended);
      if (a > cursor) pieces.push({ a: cursor, b: a, on: place });
      if (b > a) pieces.push({ a, b, on: t.task });
      cursor = Math.max(cursor, a, b);
    });
    if (ended > cursor || !pieces.length) pieces.push({ a: cursor, b: ended, on: place });
    // Only the stretches it was at work count: a session left open overnight was not working overnight.
    const at = activity(run, began, ended, signs.filter((s) => s.run === run.id).map((s) => new Date(s.ts).getTime()), now);
    for (const p of pieces)
      for (const [a, b] of at) {
        const [x, y] = [Math.max(a, p.a, from), Math.min(b, p.b, to)];
        if (y > x) spans.push({ start: iso(x), end: iso(y), by: 'when', on: p.on });
      }
  }
  return out;
}
