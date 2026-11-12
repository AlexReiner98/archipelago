// A session's reply ended: the rules on it (src/reply-rules.ts) that hold ask the agent, once a turn, and each time
// one does is kept as a beat of the session's story, where the owner sees it.

import type { Q } from '../../../src/db.ts';
import type { Archipelago, Entity } from '../../../src/pelago.ts';
import { tellStamp } from '../../../src/presence.ts';
import { atSetting, countsTo, holds, isAt, onReply, replyFacts } from './reply-rules.ts';
import type { Rule } from '../../../src/rules.ts';
import { sessionsContext, tell } from './sessions.ts';
import type { KernelContext } from '#pelago/kernel';
import { used } from '../../../src/uses.ts';

/** How long a turn's asking is remembered: past it, the turn is long over. */
const ASKED_MS = 86_400_000;

/** Which reply rules the owner has turned off here, and the number each rule that counts is set to count to: the owner's settings, read as the whole workspace (root.sessions). */
async function liftedHere(ctx: KernelContext, rules: Rule[]): Promise<{ off: Set<string>; at: Map<string, number> }> {
  const names = rules.flatMap((r) => [r.lifted!, atSetting(r)]);
  if (!names.length) return { off: new Set(), at: new Map() };
  const rows = (await ctx.call('root.sessions', { settings: names })) as { key: string; value: unknown }[];
  return { off: new Set(rows.filter((r) => r.value === true).map((r) => r.key)), at: new Map(rows.filter((r) => isAt(r.value)).map((r) => [r.key, r.value as number])) };
}

/** How far back a rule's askings are counted for the owner: a week. */
const LATELY_MS = 7 * 86_400_000;
/** The newest sessions whose stories are read for them: one that asked this week is among these. */
const RUNS_READ = 500;

/** How often each reply rule asked in the last week, by pack.id, read from the steps the sessions kept. */
export async function askedLately(whole: Q, l: Archipelago): Promise<Map<string, number>> {
  const { rows } = await whole.query<{ rule: string; n: number }>(
    `select b->>'asked' as rule, count(*)::int as n
     from (select props from entity where type = any($1::text[]) and archived_at is null order by created_at desc limit ${RUNS_READ}) e
     cross join lateral jsonb_array_elements(case when jsonb_typeof(e.props->'story') = 'array' then e.props->'story' else '[]'::jsonb end) b
     where b ? 'asked' and b->>'at' > $2 group by 1`,
    [l.registry.family('run'), new Date(Date.now() - LATELY_MS).toISOString()],
  );
  return new Map(rows.map((r) => [r.rule, r.n]));
}

/**
 * The answer to a reply's end: the rules whose when holds and that have not asked this turn ask, once: their reasons,
 * one a line, each kept as a beat of the run's story. Undefined when none does.
 */
export async function askOnReply(l: Archipelago, run: Entity | undefined, body: { session_id?: string; turn?: unknown; reply?: unknown; stop_hook_active?: unknown }) {
  const facts = replyFacts(body.reply);
  const turn = typeof body.turn === 'string' && body.turn ? body.turn : undefined;
  if (body.stop_hook_active === true || !facts || !turn || !run?.is_open) return undefined;
  const rules = l.registry.rules.filter(onReply);
  const ctx = await sessionsContext(l);
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
    used(l.workspace, 'asked', `${rule.pack}.${rule.id ?? ''}`);
    await tell(l, { kind: 'agent', name: rule.pack }, { run: run.id, said: rule.say!, asked: `${rule.pack}.${rule.id ?? ''}` }).catch((err) =>
      console.error(`reply rule ${rule.id}: not kept in the story (${(err as Error).message})`),
    );
  }
  await tellStamp(l.db, l);
  return asking.map((r) => r.say).join('\n');
}
