// A session's reply ended: the rules on it (src/reply-rules.ts) that hold ask the agent, once a turn, and each time
// one does is kept as a beat of the session's story, where the owner sees it.

import type { Q } from './db.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { tellStamp } from './presence.ts';
import { holds, onReply, replyFacts } from './reply-rules.ts';
import type { Rule } from './rules.ts';
import { tell } from './sessions.ts';
import { keep, kept } from './transient.ts';

/** How long a turn's asking is remembered: past it, the turn is long over. */
const ASKED_MS = 86_400_000;

/** Which reply rules the owner has turned off here. */
async function liftedHere(whole: Q, rules: Rule[]): Promise<Set<string>> {
  const names = rules.map((r) => r.lifted!);
  if (!names.length) return new Set();
  const { rows } = await whole.query<{ key: string; value: unknown }>(`select key, value from setting where key = any($1::text[])`, [names]);
  return new Set(rows.filter((r) => r.value === true).map((r) => r.key));
}

/**
 * The answer to a reply's end: the rules whose when holds and that have not asked this turn ask, once, as a block
 * with their reasons, each kept as a beat of the run's story. Undefined when none does.
 */
export async function askOnReply(whole: Q, l: Archipelago, run: Entity | undefined, body: { session_id?: string; turn?: unknown; reply?: unknown; stop_hook_active?: unknown }) {
  const facts = replyFacts(body.reply);
  const turn = typeof body.turn === 'string' && body.turn ? body.turn : undefined;
  if (body.stop_hook_active === true || !facts || !turn || !run?.is_open) return undefined;
  const rules = l.registry.rules.filter(onReply);
  const off = await liftedHere(whole, rules);
  const asking: Rule[] = [];
  for (const rule of rules) {
    if (off.has(rule.lifted!) || !holds(rule, facts)) continue;
    const key = `asked:${run.id}:${turn}:${rule.pack}.${rule.id ?? ''}`;
    if (await kept(whole, key)) continue;
    await keep(whole, key, true, ASKED_MS);
    asking.push(rule);
  }
  if (!asking.length) return undefined;
  for (const rule of asking) {
    await tell(l, { kind: 'agent', name: rule.pack }, { run: run.id, said: rule.say!, asked: `${rule.pack}.${rule.id ?? ''}` }).catch((err) =>
      console.error(`reply rule ${rule.id}: not kept in the story (${(err as Error).message})`),
    );
  }
  await tellStamp(whole, l.workspace);
  return { decision: 'block', reason: asking.map((r) => r.say).join('\n') };
}
