// A session's own bookkeeping: what the sessions pack writes of a run as it goes (it began, it was named, it waits, it
// ended), which no person reviews. Every such write goes through here, the one place it skips the rules, so the rule
// that will let it through is named here (docs/kernel-packs.md, "System authority": `sessions.bookkeeping`).
//
// Until the rules can say it (a rule that spares a pack's own change every hold, and a system change that keeps the
// agent it is made for as its actor), it is applied as it always was: without consulting policy, as the agent. The
// write path does it for the pack, asked through the root service root.bookkeep (packs/write/kernel/root-bookkeep.ts),
// which packs/roots.json lets the sessions pack alone call: ctx.change would log it as system:sessions.

import type { KernelContext } from '#pelago/kernel';
import type { Actor, Answer, Change } from './types.ts';

/** The rule the sessions pack declares for its bookkeeping, as a held change or an answer would name it. */
export const BOOKKEEPING = {
  rule: 'bookkeeping',
  pack: 'sessions',
  say: "A session's own record of itself (it began, was named, waits, ended) is bookkeeping: it applies as it is made.",
} as const;

type Ctx = Pick<KernelContext, 'call'>;
const ask = <O>(ctx: Ctx, what: Record<string, unknown>) => ctx.call<Record<string, unknown>, O>('root.bookkeep', what);

/** Write a session's bookkeeping, as the actor it is made for: applied as it is made, with no rule consulted. */
export const bookkeep = (ctx: Ctx, actor: string, input: Change): Promise<Answer> => ask(ctx, { apply: { actor, input } });

/** A change as an actor, judged by the rules as one it sent itself: what a session vouches for as it ends. */
export const changeAs = (ctx: Ctx, actor: Actor, input: Change): Promise<unknown> => ask(ctx, { change: { actor, input } });

/** What an item keeps of itself that is no fact about the world: a heartbeat, a count, a run's story (the operational write). */
export const operational = (
  ctx: Ctx,
  id: string,
  set: { props?: Record<string, unknown>; unset?: string[]; add?: Record<string, number> },
  event?: { actor: string; action: string; reason?: string },
): Promise<void> => ask(ctx, { operational: { id, set, ...(event && { event }) } });

/** A resource taken for a session, or given back, as the actor it is for. */
export const claimAs = (ctx: Ctx, actor: Actor, input: { resource: string; holder: string; for?: string; reason: string }) => ask(ctx, { claim: { actor, input } });
export const releaseAs = (ctx: Ctx, actor: Actor, input: { resource: string; holder?: string; reason: string }) => ask<{ released: number }>(ctx, { give_back: { actor, input } });

/** Facts on a stream the pack writes (its events, what an audit observed), as an actor. */
export const recordAs = (ctx: Ctx, stream: 'sessions' | 'observations' | 'automations', actor: string, facts: [string, string, string, unknown][]) => ask(ctx, { record: { stream, actor, facts } });
