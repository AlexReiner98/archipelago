// A run scored again against the labels as they are now, from what each replay sent: when labels change (the owner
// decides proposals, the labelling is corrected), no model is asked again.

import type { Candidate } from './replay.ts';
import { judge, summarise, type Fixture, type Judged, type Sent, type Summary, type Tally } from './score.ts';

/** One replay as a results file keeps it. */
export interface Kept {
  model: string;
  ok?: boolean;
  usd?: number;
  ms?: number;
  usage?: { input: number; output: number; cache_write: number };
  judged?: Judged;
  error?: string;
}

/** Each model's tally again, over the pushes the run read that still have a fixture. */
export function rescore(perPush: Record<string, Kept[]>, fixtures: Map<string, Fixture>, closed: (type: string) => string[], currency: (model: string) => Candidate['currency']): Summary[] {
  const tallies = new Map<string, Tally>();
  for (const [id, kept] of Object.entries(perPush)) {
    const f = fixtures.get(id);
    if (!f) continue;
    for (const k of kept) {
      const t = tallies.get(k.model) ?? { model: k.model, currency: currency(k.model), runs: 0, failed: 0, good: 0, bad: 0, unjudged: 0, copies: 0, closes: { due: 0, made: 0 }, closesAll: { due: 0, made: 0 }, tokens: 0, usd: 0, ms: 0 };
      tallies.set(k.model, t);
      t.runs++;
      if (k.error || !k.ok) t.failed++;
      if (k.error || !k.judged) continue;
      const j = judge(f, k.judged.details.map((d) => d.sent as Sent), closed);
      t.good += j.good;
      t.bad += j.bad;
      t.unjudged += j.unjudged;
      t.copies += j.copies;
      for (const c of ['closes', 'closesAll'] as const) (t[c].due += j[c].due), (t[c].made += j[c].made);
      t.tokens += (k.usage?.input ?? 0) + (k.usage?.output ?? 0) + (k.usage?.cache_write ?? 0);
      t.usd += k.usd ?? 0;
      t.ms += k.ms ?? 0;
    }
  }
  return [...tallies.values()].map(summarise);
}
