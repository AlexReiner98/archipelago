// A session's reply ended: the rules on it (src/reply-rules.ts) that hold ask the agent, once a turn, and each time
// one does is kept as a beat of the session's story, where the owner sees it.

import { shas, unaccounted } from './commits.ts';
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
    [l.registry.family('sys.run'), new Date(Date.now() - LATELY_MS).toISOString()],
  );
  return new Map(rows.map((r) => [r.rule, r.n]));
}

/**
 * The answer to a reply's end: the rules whose when holds and that have not asked this turn ask, once, as a block
 * with their reasons, each kept as a beat of the run's story. Undefined when none does.
 */
export async function askOnReply(whole: Q, l: Archipelago, run: Entity | undefined, body: { session_id?: string; turn?: unknown; reply?: unknown; turn_commits?: unknown; stop_hook_active?: unknown }) {
  const facts = replyFacts(body.reply);
  const turn = typeof body.turn === 'string' && body.turn ? body.turn : undefined;
  if (body.stop_hook_active === true || !facts || !turn || !run?.is_open) return undefined;
  const rules = l.registry.rules.filter(onReply);
  const off = await liftedHere(whole, rules);
  // The one fact read of the map: which of the commits the reply made or pushed nothing accounts for yet.
  const open = rules.some((r) => !off.has(r.lifted!) && r.when?.reply && 'unaccounted' in r.when.reply) ? await unaccounted(l, shas(body.turn_commits)) : [];
  facts.unaccounted = open.length;
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
  // A rule on unaccounted commits names them, so they are accounted for in one change.
  const said = (r: Rule) => (r.when?.reply && 'unaccounted' in r.when.reply && open.length ? `${r.say} Not accounted for: ${open.join(', ')}.` : r.say);
  return { decision: 'block', reason: asking.map(said).join('\n') };
}
