// A run that happened where Archipelago cannot watch it, told once it is over (report, action run_report).

import type { KernelContext } from '#pelago/kernel';
import { bookkeep } from './bookkeeping.ts';
import { livesInFor } from './places.ts';
import { actorId, type Actor, type Item } from './types.ts';

/** Who started a run, as the launcher says it (packs/agents/kernel/launch-brief.ts): kept on the run as it is. */
export type StartedBy = Record<string, unknown>;

/**
 * A run that happened where Archipelago cannot watch it (the agent in GitHub
 * Actions that reads a push, or re-checks the map) says so once it is over:
 * what it was, how it ended and what it used. It is kept as a run that has
 * ended, in the repository it ran for. Told twice of the same run (its link
 * is the same), it is recorded once.
 */
export async function recordRun(
  ctx: KernelContext,
  actor: Actor,
  input: { repo: string; title: string; ok?: boolean; tokens?: number; cost_usd?: number; turns?: number; link?: string; summary?: string; surface?: string; started_by?: StartedBy },
) {
  const repo = /^e_[a-z0-9]{8}$/.test(input.repo)
    ? ((await ctx.reads({ ids: [input.repo] })) as Item[])[0]
    : ((await ctx.call<{ remote: string }, { place: Item | null }>('answer.place_for', { remote: input.repo })).place ?? undefined);
  if (!repo) throw new Error(`No repository "${input.repo}" in the map`);
  if (input.link) {
    const had = (await ctx.reads({ run_reported: { link: input.link, title: input.title } })) as string | null;
    if (had) return { run: had, recorded: false };
  }
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);
  const props: Record<string, unknown> = { surface: input.surface ?? 'github-actions', last_seen: ctx.now().toISOString() };
  if (number(input.tokens) !== undefined) props.tokens_used = Math.round(input.tokens!);
  if (number(input.cost_usd) !== undefined) props.cost_usd = Math.round(input.cost_usd! * 10_000) / 10_000;
  if (number(input.turns) !== undefined) props.turns = input.turns;
  if (input.link) props.link = input.link; if (input.started_by) props.started_by = input.started_by;
  const { created } = await bookkeep(ctx, actorId(actor), {
    ops: [
      { op: 'create', ref: 'run', type: 'run', title: input.title, status: input.ok === false ? 'failed' : 'finished', body: input.summary?.slice(0, 4000), props },
      { op: 'link', type: livesInFor(ctx, repo.type), from: 'run', to: repo.id },
    ],
    reason: 'Run reported',
  });
  return { run: created.run, recorded: true };
}
