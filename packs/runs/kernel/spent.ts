// What agents spent: measured from their runs, which are the kernel's own record of every session. A run that says
// what it cost is counted in dollars; one that reports only tokens (a session on a subscription) is counted in
// tokens. What else the work costs (hosting, a subscription) is a pack's to keep: the time pack's costs view adds
// its payments to this.

import type { KernelContext } from '#pelago/kernel';

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100) / 100;

/** What agents spent over the last days, by where they ran. */
export async function spent(ctx: KernelContext, input: { days?: number }) {
  const days = Math.min(Math.max(Math.round(input.days ?? 30), 1), 366);
  const since = ctx.now().getTime() - days * DAY;
  const runs = (await ctx.reads({ runs_made: { types: ctx.registry.family('run'), since: new Date(since).toISOString() } })) as { id: string; title: string; props: Record<string, unknown>; created_at: Date }[];
  const by = new Map<string, { surface: string; runs: number; tokens: number; cost_usd: number; unpriced_tokens: number }>();
  for (const run of runs) {
    const tokens = Number(run.props.tokens_used ?? 0);
    const cost = typeof run.props.cost_usd === 'number' ? run.props.cost_usd : undefined;
    if (!tokens && cost === undefined) continue;
    const surface = (run.props.surface as string | undefined) ?? 'unknown';
    const sum = by.get(surface) ?? { surface, runs: 0, tokens: 0, cost_usd: 0, unpriced_tokens: 0 };
    sum.runs++;
    sum.tokens += tokens;
    if (cost === undefined) sum.unpriced_tokens += tokens;
    else sum.cost_usd += cost;
    by.set(surface, sum);
  }
  const surfaces = [...by.values()].map((s) => ({ ...s, cost_usd: cents(s.cost_usd) })).sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens);
  return {
    days,
    since: new Date(since).toISOString(),
    cost_usd: cents(surfaces.reduce((n, s) => n + s.cost_usd, 0)),
    tokens: surfaces.reduce((n, s) => n + s.tokens, 0),
    /** Tokens used by runs that do not say what they cost (a session on a subscription): not in the dollars. */
    unpriced_tokens: surfaces.reduce((n, s) => n + s.unpriced_tokens, 0),
    by: surfaces,
  };
}
