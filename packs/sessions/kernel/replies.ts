// A session's reply ended: the rules on it (./reply-rules.ts) that hold ask the agent, once a turn, and each time one
// does is kept as a beat of the session's story, where the owner sees it. How often each asked lately is surface's
// to count for the owner (root-sessions.ts, askedLately), as the whole workspace.

import type { KernelContext } from '#pelago/kernel';
import { atSetting, holds, isAt, onReply, replyFacts, type RuleDef } from './reply-rules.ts';
import { tell } from './session-life.ts';
import type { Item } from './types.ts';

/** How long a turn's asking is remembered: past it, the turn is long over. */
const ASKED_MS = 86_400_000;

type Rule = RuleDef & { pack: string };

/** Which reply rules the owner has turned off here, and the number each rule that counts is set to count to: the owner's settings, read as the whole workspace (root.sessions). */
async function liftedHere(ctx: KernelContext, rules: Rule[]): Promise<{ off: Set<string>; at: Map<string, number> }> {
  const names = rules.flatMap((r) => [r.lifted!, atSetting(r)]);
  if (!names.length) return { off: new Set(), at: new Map() };
  const rows = (await ctx.call('root.sessions', { settings: names })) as { key: string; value: unknown }[];
  return { off: new Set(rows.filter((r) => r.value === true).map((r) => r.key)), at: new Map(rows.filter((r) => isAt(r.value)).map((r) => [r.key, r.value as number])) };
}

/**
 * The answer to a reply's end: the rules whose when holds and that have not asked this turn ask, once: their reasons,
 * one a line, each kept as a beat of the run's story. Undefined when none does.
 */
export async function askOnReply(ctx: KernelContext, run: Pick<Item, 'id' | 'is_open'> | undefined, body: { session_id?: string; turn?: unknown; reply?: unknown; stop_hook_active?: unknown }) {
  const facts = replyFacts(body.reply);
  const turn = typeof body.turn === 'string' && body.turn ? body.turn : undefined;
  if (body.stop_hook_active === true || !facts || !turn || !run?.is_open) return undefined;
  const rules = (ctx.registry.rules as Rule[]).filter(onReply);
  const { off, at } = await liftedHere(ctx, rules);
  const asking: Rule[] = [];
  for (const rule of rules) {
    if (off.has(rule.lifted!) || !holds(rule, facts, at.get(atSetting(rule)))) continue;
    const key = `asked:${run.id}:${turn}:${rule.pack}.${rule.id ?? ''}`;
    // Kept in the whole workspace's transient store (root.transient), so another server asked next knows it asked.
    if (await ctx.call('root.transient', { kept: key })) continue;
    await ctx.call('root.transient', { keep: { key, value: true, ms: ASKED_MS } });
    asking.push(rule);
  }
  if (!asking.length) return undefined;
  for (const rule of asking) {
    // Each asking is counted for the Packs screen (root.uses), as a use of the rule.
    await ctx.call('root.uses', { add: [{ key: `asked:${`${rule.pack}.${rule.id ?? ''}`.replace(/\s/g, '_')}` }] }).catch((err) => ctx.said(`counting an asking failed: ${(err as Error).message}`));
    await tell(ctx, { kind: 'agent', name: rule.pack }, { run: run.id, said: rule.say!, asked: `${rule.pack}.${rule.id ?? ''}` }).catch((err) =>
      ctx.said(`reply rule ${rule.id}: not kept in the story (${(err as Error).message})`),
    );
  }
  // The beats moved the tell stamp, so a page polling for them hears them (the presence pack's).
  await ctx.call('act.report.told', {});
  return asking.map((r) => r.say).join('\n');
}
