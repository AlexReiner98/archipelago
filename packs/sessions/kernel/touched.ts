// What a session touched: the items it read, showed or changed, as a set kept with its run. Each read is presence
// (src/presence.ts), kept nowhere; only the set is kept, in the transient store (src/transient.ts) under the run, for
// a week after the session was last heard from, and a week after it ends. Every agent session may share one token, so
// the server cannot tell from a call whose session made it: the session's own hook says, at each prompt, turn and
// end, which items its calls to the map named (scripts/pelago-hook.mjs reads them from the session's transcript).
// Only the whole workspace reaches the store: it is kept and read through the surface's root.transient, as the whole
// workspace of the map that asks, as it was before the pack moved.

import type { KernelContext } from '#pelago/kernel';

/** How long a run's set is kept after it was last heard from, or ended. */
export const TOUCHED_MS = 7 * 86_400_000;
/** The most items a run's set holds: past it, the first touched are let go. */
export const TOUCHED_KEPT = 500;
const ID = /^e_[a-z0-9]{8}$/;
const key = (run: string) => `touched:${run}`;
/** The most keys one read of the store takes (root.transient). */
const SCAN = 100;

type Ctx = Pick<KernelContext, 'call'>;
const kept = async (ctx: Ctx, run: string) => ((await ctx.call('root.transient', { kept: key(run) })) as string[] | undefined) ?? undefined;
const keep = (ctx: Ctx, run: string, ids: string[]) => ctx.call('root.transient', { keep: { key: key(run), value: ids, ms: TOUCHED_MS } });

/** Add what the hook says a run touched to its set, and keep the set a week from now. */
export async function addTouched(ctx: Ctx, run: string, said: unknown): Promise<string[]> {
  const ids = Array.isArray(said) ? said.filter((v): v is string => typeof v === 'string' && ID.test(v)) : [];
  const had = (await kept(ctx, run)) ?? [];
  const all = [...new Set([...had, ...ids])].slice(-TOUCHED_KEPT);
  await keep(ctx, run, all);
  return all;
}

/** The items a run touched, in the order it first touched them. */
export async function touchedBy(ctx: Ctx, run: string): Promise<string[]> {
  return (await kept(ctx, run)) ?? [];
}

/** The items each of some runs touched, read at once, in the order the runs are given: a read a hundred runs, not one a run. */
export async function touchedByAll(ctx: Ctx, runs: string[]): Promise<string[]> {
  const sets = new Map<string, string[]>();
  for (let i = 0; i < runs.length; i += SCAN) {
    const rows = (await ctx.call('root.transient', { scan: { keys: runs.slice(i, i + SCAN).map(key) } })) as { key: string; value: string[] }[];
    for (const r of rows) sets.set(r.key, r.value);
  }
  return runs.flatMap((run) => sets.get(key(run)) ?? []);
}

/** A run has ended: its set is kept a week from now. */
export async function keepTouched(ctx: Ctx, run: string): Promise<void> {
  const had = await kept(ctx, run);
  if (had) await keep(ctx, run, had);
}
