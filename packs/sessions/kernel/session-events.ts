// What a session did, as raw events in one vocabulary (docs/sessions.md): an adapter sends them in batches
// (POST /hooks/events), each is checked against its kind, one the run already has (same at, kind and turn) is dropped,
// and the rest are appended in order to the sessions stream as `event` facts on the run, sealed with the run's key as
// every value about an item is there (packs/seal/kernel/opseal.ts). Turns, states and a session's line are worked out from them.

import type { KernelContext } from '#pelago/kernel';
import { actorId } from './types.ts';
import { resolveRun } from './chat-run.ts';

/** One event as the vocabulary has it: when, what kind, the source's turn when it knows one, and its kind's fields. */
export interface SessionEvent {
  at: string;
  kind: string;
  turn?: string;
  /** The adapter that sent it (claude-code, agent-sdk). */
  source?: string;
  [field: string]: unknown;
}

/** The field each fact of an event is kept under, on its run: kept by the retention rule `session_events`. */
export const EVENT_FIELD = 'event';

type Field = { is: 'string' | 'boolean' | 'number' | 'strings' | 'tokens'; of?: string[]; cut?: number; need?: boolean };
const one = (of: string[]): Field => ({ is: 'string', of, need: true });
const words = (cut: number): Field => ({ is: 'string', cut });

/** The kinds and their fields: `need` must be there, `of` lists the values it takes, `cut` is the length it is cut to. */
export const KINDS: Record<string, Record<string, Field>> = {
  'turn.start': { by: one(['person', 'session', 'event']), from: { is: 'string' }, gist: words(200) },
  'tool.end': {
    tool: one(['read', 'edit', 'shell', 'search', 'map', 'web', 'agent', 'other']),
    name: { is: 'string', need: true },
    ok: { is: 'boolean', need: true },
    files: { is: 'strings' },
    items: { is: 'strings' },
  },
  'test.run': { ok: { is: 'boolean', need: true }, passed: { is: 'number' }, failed: { is: 'number' }, command: words(120) },
  commit: { sha: { is: 'string', need: true }, subject: { is: 'string', need: true } },
  'wait.start': { for: one(['permission', 'input']), gist: words(200) },
  'wait.end': { for: one(['permission', 'input']) },
  'turn.end': { ended: one(['asked', 'done', 'stopped', 'failed']), question: words(500), gist: words(200), tokens: { is: 'tokens' } },
  'session.start': { parent: { is: 'string' }, title: { is: 'string' }, branch: { is: 'string' } },
  'session.end': { reason: { is: 'string' } },
};
const TOKENS = ['input', 'output', 'cache_read', 'cache_write'];

const fits = (f: Field, v: unknown): boolean => {
  if (f.is === 'strings') return Array.isArray(v) && v.every((s) => typeof s === 'string');
  if (f.is === 'tokens') return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.entries(v).every(([k, n]) => TOKENS.includes(k) && typeof n === 'number' && n >= 0);
  if (f.is === 'number') return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return typeof v === f.is && (!f.of || f.of.includes(v as string));
};

/** An event as it is kept, or the reason it is refused. */
export function checkEvent(raw: unknown, source?: string): { event: SessionEvent } | { problem: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { problem: 'an event is an object' };
  const { at, kind, turn, ...rest } = raw as Record<string, unknown>;
  const fields = typeof kind === 'string' ? KINDS[kind] : undefined;
  if (!fields) return { problem: `kind is one of ${Object.keys(KINDS).join(', ')}` };
  const when = typeof at === 'string' ? new Date(at) : undefined;
  if (!when || Number.isNaN(when.getTime())) return { problem: `${kind}: at is an ISO time` };
  if (turn !== undefined && (typeof turn !== 'string' || !turn)) return { problem: `${kind}: turn is the source's id for it` };
  const event: SessionEvent = { at: when.toISOString(), kind: kind as string, ...(turn !== undefined && { turn: turn as string }), ...(source && { source }) };
  for (const [name, v] of Object.entries(rest)) {
    const f = fields[name];
    if (!f) return { problem: `${kind} has no field "${name}" (${Object.keys(fields).join(', ')})` };
    if (v === undefined || v === null) continue;
    if (!fits(f, v)) return { problem: `${kind}: ${name} is ${f.of ? f.of.join(' or ') : f.is === 'strings' ? 'a list of strings' : f.is === 'tokens' ? `counts of ${TOKENS.join(', ')}` : `a ${f.is}`}` };
    event[name] = f.cut && typeof v === 'string' && v.length > f.cut ? `${v.slice(0, f.cut - 1)}…` : v;
  }
  const missing = Object.entries(fields).find(([name, f]) => f.need && event[name] === undefined);
  if (missing) return { problem: `${kind} needs ${missing[0]}` };
  return { event };
}

/** What makes two events the same one: an adapter may send an event again. */
const SAME = ['at', 'kind', 'turn'];

/** A run's events in order, by when they happened, as the source's clock had it; [] for a run there is none of. Read from the run's start, so the read is bounded by the stream's time. */
export async function sessionEvents(ctx: KernelContext, run: string): Promise<SessionEvent[]> {
  const [found] = (await ctx.reads({ ids: [run] })) as { created_at: string | Date }[];
  if (!found) return [];
  const events = (await ctx.reads({ run_events: { runs: [run], since: new Date(found.created_at).toISOString() } })) as Record<string, SessionEvent[]>;
  return events[run] ?? [];
}

export interface EventsBody {
  session_id?: string;
  source?: unknown;
  events?: unknown;
}

/**
 * Take a batch of events for the run a session id names: each checked, those the run has already (or the batch has
 * twice) dropped, the rest appended in the order sent, in one entry. What was refused is said, by its place in the batch.
 */
export async function takeEvents(ctx: KernelContext, body: EventsBody) {
  const run = body.session_id ? await resolveRun(ctx, body.session_id) : undefined;
  if (!run) return { run: null, kept: 0, problem: 'No run has this session id: start the session first.' };
  const source = typeof body.source === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(body.source) ? body.source : undefined;
  if (!source) return { run: run.id, kept: 0, problem: 'source names the adapter, like claude-code.' };
  const batch = Array.isArray(body.events) ? body.events : [];
  const refused: { at: number; problem: string }[] = [];
  const good: SessionEvent[] = [];
  batch.forEach((raw, i) => {
    const checked = checkEvent(raw, source);
    if ('problem' in checked) refused.push({ at: i, problem: checked.problem });
    else good.push(checked.event);
  });
  // One batch of a run at a time, those it has already dropped, in one entry: the write path's, under its lock (root.bookkeep).
  const kept = (await ctx.call('root.bookkeep', { events: { run: run.id, since: new Date(run.created_at).toISOString(), actor: actorId({ kind: 'agent', name: source }), field: EVENT_FIELD, values: good, same: SAME } })) as number;
  return { run: run.id, kept, dropped: good.length - kept, ...(refused.length && { refused }) };
}
