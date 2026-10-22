// Scoring a replay against a push's labels, and choosing a model from the scores. Pure.

import { copyOf, kindOf, similar, type Item, type Label } from './history.ts';

/** One push with its right answer, as the export writes it. */
export interface Fixture {
  id: string;
  repo: { name: string; entity: { id: string; title: string; type: string } };
  push: { branch: string; default_branch: string; before: string; after: string; ts: string };
  commits: string[];
  /** The open items as they stood when the push landed. */
  items: Item[];
  labels: Label[];
}

/** What a replay sent, said in the fixture's ids. */
export type Sent = { op: 'create'; title: string } | { op: 'update'; id: string; status?: string; title?: string; append?: string } | { op: 'archive'; id: string };

export interface Judged {
  good: number;
  bad: number;
  /** Changes no label speaks to. */
  unjudged: number;
  copies: number;
  /** Closes the push should bring, and how many of them the replay made. */
  closes: { due: number; made: number };
  /** The same, counting closes that stand only because nobody undid them. */
  closesAll: { due: number; made: number };
  details: { sent: Sent; verdict: 'good' | 'bad' | 'unjudged'; basis: string }[];
}

/** Judge what one replay sent against the push's labels. */
export function judge(f: Fixture, sent: Sent[], closed: (type: string) => string[]): Judged {
  const typeOf = new Map(f.items.map((i) => [i.id, i.type]));
  const titles = f.items.map((i) => i.title);
  const made: string[] = [];
  const out: Judged = { good: 0, bad: 0, unjudged: 0, copies: 0, closes: { due: 0, made: 0 }, closesAll: { due: 0, made: 0 }, details: [] };
  const closedNow = new Set<string>();
  for (const s of sent) {
    let verdict: 'good' | 'bad' | 'unjudged' = 'unjudged';
    let basis = 'no label';
    if (s.op === 'create') {
      const copy = copyOf(s.title, [...titles, ...made]);
      made.push(s.title);
      const label = f.labels.filter((l) => l.change === 'create' && l.title).sort((a, b) => similar(b.title!, s.title) - similar(a.title!, s.title))[0];
      if (copy) (verdict = 'bad'), (basis = `copy of "${copy}"`), out.copies++;
      else if (label && !label.weak && similar(label.title!, s.title) >= 0.6) (verdict = label.verdict), (basis = label.basis);
    } else if (s.op === 'archive') {
      const label = f.labels.find((l) => l.change === 'archive' && l.item === s.id && !l.weak);
      if (label) (verdict = label.verdict), (basis = label.basis);
    } else {
      const kind = kindOf(s, closed(typeOf.get(s.id) ?? ''));
      if (kind?.change === 'close') closedNow.add(s.id);
      const label = kind && f.labels.find((l) => l.item === s.id && l.change === kind.change && (kind.change !== 'status' || l.to === kind.to));
      if (label && !label.weak) (verdict = label.verdict), (basis = label.basis);
      // The reader's own rule: on a branch other than the default, work is in progress, never finished.
      else if (kind?.change === 'close' && f.push.branch !== f.push.default_branch) (verdict = 'bad'), (basis = 'closed on a branch');
      else if (label) basis = `${label.basis} (weak)`;
    }
    out[verdict === 'unjudged' ? 'unjudged' : verdict]++;
    out.details.push({ sent: s, verdict, basis });
  }
  // A close is due only on the default branch: the reader never closes on a branch, so one approved there is not
  // held against it (whether it should is the reader's rule to settle, not the evaluation's).
  const due = f.push.branch === f.push.default_branch ? f.labels.filter((l) => l.change === 'close' && l.verdict === 'good') : [];
  for (const l of due) {
    out.closesAll.due++;
    if (closedNow.has(l.item!)) out.closesAll.made++;
    if (l.weak) continue;
    out.closes.due++;
    if (closedNow.has(l.item!)) out.closes.made++;
  }
  return out;
}

/** What one model did over every push. */
export interface Tally {
  model: string;
  /** What usd is counted in: a model priced in euros is said in euros. */
  currency: 'USD' | 'EUR';
  runs: number;
  failed: number;
  good: number;
  bad: number;
  unjudged: number;
  copies: number;
  closes: { due: number; made: number };
  closesAll: { due: number; made: number };
  tokens: number;
  usd: number;
  ms: number;
}

export interface Summary extends Tally {
  /** Of what it sent that a label speaks to, the share that was right. */
  precision: number;
  /** The same, counting what no label speaks to as not approved: what the owner would have to look at for nothing. */
  strict: number;
  recall: number;
  recallAll: number;
  /** Changes sent per push. */
  perPush: number;
  usdPerPush: number;
  secondsPerPush: number;
  /** Right changes per dollar. */
  goodPerUsd: number;
  quality: number;
}

const ratio = (a: number, b: number, none = 1) => (b ? a / b : none);

export function summarise(t: Tally): Summary {
  const precision = ratio(t.good, t.good + t.bad);
  const strict = ratio(t.good, t.good + t.bad + t.unjudged);
  const recall = ratio(t.closes.made, t.closes.due);
  const recallAll = ratio(t.closesAll.made, t.closesAll.due);
  // Quality is what the issue asks for: changes the owner would approve, and the closes that are due. A wrong change
  // costs the owner more than a missed one, so precision weighs twice (an F-score with beta 0.5).
  const quality = strict + recall ? (1.25 * strict * recall) / (0.25 * recall + strict) : 0;
  return {
    ...t,
    precision,
    strict,
    recall,
    recallAll,
    perPush: ratio(t.good + t.bad + t.unjudged, t.runs, 0),
    usdPerPush: ratio(t.usd, t.runs, 0),
    secondsPerPush: ratio(t.ms / 1000, t.runs, 0),
    goodPerUsd: t.usd ? t.good / t.usd : 0,
    quality,
  };
}

/**
 * The default is the cheapest model whose quality is within `slack` of the best, and that failed no more runs than
 * the best did; the fallback, for when it cannot answer, is the cheapest other one within twice that slack,
 * else the best of the others; none, when no other one does any good.
 */
export function choose(models: Summary[], slack = 0.05): { default?: Summary; fallback?: Summary; why: string } {
  const ran = models.filter((m) => m.runs > m.failed);
  if (!models.length) return { why: 'No candidate model was run.' };
  if (!ran.length) return { why: 'No model finished a run.' };
  const best = Math.max(...ran.map((m) => m.quality));
  const fewest = Math.min(...ran.map((m) => m.failed / m.runs));
  const byPrice = [...ran].sort((a, b) => a.usdPerPush - b.usdPerPush);
  const pick = byPrice.find((m) => m.quality >= best - slack && m.failed / m.runs <= fewest + 0.05) ?? byPrice.find((m) => m.quality === best)!;
  const others = byPrice.filter((m) => m !== pick && m.quality > 0);
  const fallback = others.find((m) => m.quality >= best - 2 * slack) ?? [...others].sort((a, b) => b.quality - a.quality)[0];
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const money = (m: Summary) => `${m.currency === 'EUR' ? '€' : '$'}${m.usdPerPush.toFixed(4)}`;
  const why = `${pick.model} is the cheapest whose quality (${pct(pick.quality)}) is within ${pct(slack)} of the best (${pct(best)}), at ${money(pick)} a push${fallback ? `; ${fallback.model} (${pct(fallback.quality)}, ${money(fallback)} a push) is the ${fallback.quality >= best - 2 * slack ? 'next that comes close' : 'best of the rest'}` : '; no other model does well enough to fall back on'}.`;
  return { default: pick, fallback, why };
}
