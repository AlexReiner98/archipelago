// What the runs pack answers by name (pack.json, kernel.provides): the reads of core's run and works_on that any pack
// may call (decision e_w4bmpnx3). Each takes one input object and answers values a pipe can carry: a map by run is an
// object keyed by run id.

import type { KernelContext } from '#pelago/kernel';
import { FRONTIER_REASONS, frontier as frontierOf, frontierText, said, workedOn as worked, type FrontierInput } from './frontier.ts';
import { narrowed as narrowedOf } from './frontier-prompt.ts';
import { livesIn as livesInOf, livesInFor, placeFor as placeOf } from './places.ts';
import { byAttention, markOf, sessionStates } from './session-state.ts';
import { sessionMeasures, type MeasuresInput } from './session-measures.ts';
import { runSpans, type Run } from './sessiontime.ts';
export { spent } from './spent.ts';
export { turns } from './run-turns.ts';

const ids = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string')) throw new Error(`${what} is a list of ids`);
  return v as string[];
};

/**
 * Where a session stands, and what there needs it: the frontier. said: each reason with its few words, the strongest
 * first; lines: the frontier as the lines a session is handed as it starts.
 */
export async function frontier(ctx: KernelContext, input: FrontierInput & { said?: boolean; lines?: boolean }) {
  const { said: withSaid, lines, run, cwd, remote, limit } = input ?? {};
  const f = await frontierOf(ctx, { run, cwd, remote, limit });
  const rank = (r: { why: string }) => FRONTIER_REASONS.indexOf(r.why as (typeof FRONTIER_REASONS)[number]);
  const items = withSaid ? f.items.map((i) => ({ ...i, reasons: [...i.reasons].sort((a, b) => rank(a) - rank(b)).map((r) => ({ ...r, said: said(r) })) })) : f.items;
  return { ...f, items, ...(lines && { lines: frontierText(f) }) };
}

/** What some sessions worked on: what they changed, touched or were set to work on. */
export const workedOn = async (ctx: KernelContext, input: { runs: string[] }) => ({ ids: await worked(ctx, ids(input?.runs, 'runs')) });

/** The states of some runs, by run id (a run not found is left out), each with its latest turn and how many it has had. */
export async function states(ctx: KernelContext, input: { runs: string[]; now?: string }) {
  return { states: Object.fromEntries(await sessionStates(ctx, ids(input?.runs, 'runs'), input.now)) };
}

/** The marks of some runs' states, by run id, as the sessions view and the flat answer carry them; order: the runs found, by their states' attention. */
export async function marks(ctx: KernelContext, input: { runs: string[]; now?: string }) {
  const found = await sessionStates(ctx, ids(input?.runs, 'runs'), input.now);
  const marked = Object.fromEntries([...found].map(([run, s]) => [run, markOf(s)]));
  return { marks: marked, order: Object.keys(marked).sort((a, b) => byAttention(marked[a], marked[b])) };
}

/** When some sessions were at work between two instants (milliseconds), cut by the work each was on: spans by run id. */
export async function spans(ctx: KernelContext, input: { runs: Run[]; from: number; to: number; now?: number }) {
  return { spans: Object.fromEntries(await runSpans(ctx, input.runs ?? [], input.from, input.to, input.now)) };
}

/** What sessions' turns tell over a range: those waiting on their person, turns and tokens per item, those stalled. */
export const measures = (ctx: KernelContext, input: MeasuresInput) => sessionMeasures(ctx, input ?? {});

/** The place a session's keys name (its remote, else the folder it runs in), if the map holds one. */
export const placeFor = async (ctx: KernelContext, input: { remote?: string; cwd?: string }) => ({ place: (await placeOf(ctx, input ?? {})) ?? null });

/** The links a thing lives in a place by; with type, the one that ties a thing to a place of that type. */
export const livesIn = (ctx: KernelContext, input: { type?: string }) => ({ kinds: livesInOf(ctx), ...(typeof input?.type === 'string' && { link: livesInFor(ctx, input.type) }) });

/** What the map has settled and left open on some text a session was asked. */
export const narrowed = (ctx: KernelContext, input: { text: string }) => narrowedOf(ctx, String(input?.text ?? ''));
