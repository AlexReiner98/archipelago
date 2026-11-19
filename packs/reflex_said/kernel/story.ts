// The tree's story over a window, decided without the map: the nodes asked, the sayings, their records and the
// misses in, one answer out for the drawing to lay along its film (the owner's meanings on e_yhqubh9k): sparks where a
// miss nothing covered fell (on the trial node grown from it, if one was), blue where a saying held, a mark where it
// failed. Imports nothing; story-read.ts reads.

import type { Miss } from './misses.ts';
import type { Record_, Saying, Tier, Verdict } from './record.ts';
import type { Fired, RuleNode } from './rule-nodes.ts';

export interface StoryNode {
  id: string;
  /** Said (an instruction), enforced (a rule), or the schema: a type and the checks it implies. */
  kind: 'instruction' | 'rule' | 'type' | 'check';
  /** The pack it came from; workspace or repository for the owner's own; reflex for learned. */
  pack: string;
  tier: Tier | 'schema';
  /** A type's words: its description. */
  words?: string;
  /** A rule's: hold, refuse, ask, requires... */
  effect?: string;
  status?: string;
  for: string[];
  title?: string;
}

export interface Story {
  from: string;
  to: string;
  nodes: StoryNode[];
  misses: { at: string; where: string; kind: Miss['kind']; grew?: string }[];
  said: { id: string; at: string; verdict: Verdict }[];
  /** Each rule's firings by day: held, refused or asked, how many. */
  fired: Fired[];
}

/**
 * The story: the nodes asked and every other said in the window (a preset is no item, but the trunk is drawn from it);
 * each miss no open node covers, or that only a trial covers (that trial grew from it); each saying with what became
 * of its miss in its run.
 */
export function storyOf(input: { from: string; to: string; asked: StoryNode[]; others: StoryNode[]; rules?: RuleNode[]; schema?: StoryNode[]; fired?: Fired[]; sayings: Saying[]; records: Pick<Record_, 'id' | 'per_run'>[]; misses: Miss[]; trials: Set<string> }): Story {
  const verdict = new Map(input.records.flatMap((r) => r.per_run.map((v) => [`${r.id} ${v.run}`, v.verdict] as const)));
  const shown = new Set(input.asked.map((n) => n.id));
  // Every rule in force is drawn, fired or not: a rule is there whether or not it was met.
  const nodes = [...input.asked, ...input.others.filter((n) => !shown.has(n.id) && input.sayings.some((s) => s.id === n.id)), ...(input.rules ?? []).filter((r) => !shown.has(r.id)), ...(input.schema ?? []).filter((n) => !shown.has(n.id))];
  const misses = input.misses
    .filter((m) => m.at >= input.from && m.at <= input.to && m.covered_by.every((id) => input.trials.has(id)))
    .map((m) => ({ at: m.at, where: m.where, kind: m.kind, ...(m.covered_by.length && { grew: m.covered_by[0] }) }));
  const said = input.sayings
    .filter((s) => s.at >= input.from && s.at <= input.to)
    .map((s) => ({ id: s.id, at: s.at, verdict: verdict.get(`${s.id} ${s.run}`) ?? 'quiet' }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { from: input.from, to: input.to, nodes, misses, said, fired: input.fired ?? [] };
}
