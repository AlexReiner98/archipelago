/**
 * The keep rules, apart from the runtime: a trial node's record in, its
 * standing out (stay on trial, promote, retire, and why); a node's words
 * in, what is wrong with them out.
 *
 * A trial node earns its place with evidence: runs where it held (a miss
 * came before and none after, or its miss's situation came up again and
 * went right). It loses it when its miss keeps coming after it was said
 * (failing), when it is said run after run and nothing it is about ever
 * comes up (idle: stale, or too generic to matter), or when another node
 * at its place already says the same (duplicate).
 *
 * A replay (a recorded run played again with the node said: packs/replay)
 * is evidence too, but less: the agent's side is what happened then, and it
 * never heard the node. So a replayed run counts `replay` of a live one
 * (default a half) toward held and quiet runs, a promotion still needs one
 * live held run, and a replayed failure counts toward nothing: the miss came
 * after the node would have been said, to an agent that didn't hear it.
 */
import type { Json } from "../../spec/common.ts";

/** The record a standing is judged from (the verdict pack's NodeRecord). */
export interface Tally {
  said: number;
  runs: number;
  held: number;
  failed: number;
  quiet: number;
}

/** The settings a person can change (the pack's config). */
export interface Thresholds {
  /** Held runs it takes to promote, with failures at most a third of them. */
  promote: number;
  /** Failed runs it takes to retire, when they outnumber the held ones. */
  fail: number;
  /** Runs said in, with nothing held or failed, it takes to retire as idle. */
  idle: number;
  /** Share of words in common with another node at its place that makes it a duplicate (0 to 1). */
  same: number;
  /** What a replayed run counts toward held and quiet runs, against a live one's 1 (0 to 1; 0: replays count for nothing). */
  replay: number;
}

export const DEFAULTS: Thresholds = { promote: 3, fail: 2, idle: 12, same: 0.6, replay: 0.5 };

/** Live and replayed runs, weighed: what the thresholds are held against. */
export interface Weighed {
  runs: number;
  held: number;
  failed: number;
  quiet: number;
}

/** A record with its replays at their weight. Failures are live only. */
export function weigh(live: Tally | undefined, replayed: Tally | undefined, w: number): Weighed {
  const l = live ?? { said: 0, runs: 0, held: 0, failed: 0, quiet: 0 };
  const r = replayed ?? { said: 0, runs: 0, held: 0, failed: 0, quiet: 0 };
  const k = Math.max(0, Math.min(1, w));
  return { runs: l.runs + k * (r.held + r.quiet), held: l.held + k * r.held, failed: l.failed, quiet: l.quiet + k * r.quiet };
}

/** A weighed count in words: whole, or to one decimal. */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export type State = "trial" | "promote" | "retire";
export type Rule = "held" | "failing" | "idle" | "duplicate";

export interface Standing {
  state: State;
  rule?: Rule;
  why: string;
  /** For a duplicate: the node it repeats. */
  of?: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Words too common to tell two pieces of advice apart. */
const COMMON = new Set(
  "the and for not but with that this then than was were are has have had its into from out off one all any can cannot could should would will you your when what which who how why there here use used using get got make made call called file files tool tools error errors failed fails fail failure because before after again only also just what fixed it".split(" "),
);

export function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) if (w.length >= 3 && !COMMON.has(w)) out.add(w);
  return out;
}

/** The share of words two texts have in common (Jaccard). */
export function overlap(a: string, b: string): number {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** Another node a trial could repeat: at a place it shares, said as kept or written before it. */
export interface Peer {
  id: string;
  title: string;
  at: string[];
  words: string;
  kept: boolean;
}

/**
 * A trial node's standing from its live record (undefined: never said), its
 * replayed one, and its peers.
 */
export function standing(
  node: { id: string; at: string[]; words: string },
  record: Tally | undefined,
  peers: Peer[],
  t: Thresholds = DEFAULTS,
  replayed?: Tally,
): Standing {
  const live = record ?? { said: 0, runs: 0, held: 0, failed: 0, quiet: 0 };
  const r = weigh(live, replayed, t.replay ?? DEFAULTS.replay);
  const rep = replayed?.runs ? ` (${plural(replayed.runs, "replay")} at ${num(t.replay ?? DEFAULTS.replay)} each)` : "";
  const dup = peers
    .filter((p) => p.id !== node.id && (p.kept || p.id < node.id) && p.at.some((a) => node.at.includes(a)))
    .map((p) => ({ p, share: overlap(node.words, p.words) }))
    .filter((x) => x.share >= t.same)
    .sort((a, b) => b.share - a.share)[0];
  if (dup) {
    return { state: "retire", rule: "duplicate", of: dup.p.id, why: `says what “${dup.p.title}” says at the same place (${Math.round(dup.share * 100)}% of words in common).` };
  }
  if (r.failed >= t.fail && r.failed > r.held) {
    return { state: "retire", rule: "failing", why: `its miss came again after it was said, in ${plural(r.failed, "run")} of ${live.runs}.` };
  }
  if (r.held >= t.promote && r.failed * 3 <= r.held && live.held >= 1) {
    return { state: "promote", rule: "held", why: `it held in ${num(r.held)} of ${num(r.runs)} runs${rep}${r.failed ? `, failed in ${r.failed}` : ", and never failed"}.` };
  }
  if (r.runs >= t.idle && r.held === 0 && r.failed === 0) {
    return { state: "retire", rule: "idle", why: `said ${plural(live.said + (replayed?.said ?? 0), "time")} in ${num(r.runs)} runs${rep}, and what it is about never came up: nothing it prevents, nothing it fixes.` };
  }
  const toPromote = Math.max(0, t.promote - r.held);
  const toIdle = Math.max(0, t.idle - r.runs);
  const needLive = r.held >= t.promote && r.failed * 3 <= r.held && live.held < 1;
  return {
    state: "trial",
    why: r.runs || replayed?.runs
      ? `held ${num(r.held)}, failed ${r.failed}, quiet ${num(r.quiet)}${rep}: ${needLive ? "one live held run to promote: replays alone don't" : toPromote ? `${num(toPromote)} more held run${toPromote === 1 ? "" : "s"} to promote` : "fails too often to promote"}${r.held || r.failed ? "" : `; retired as idle after ${num(toIdle)} more quiet run${toIdle === 1 ? "" : "s"}`}.`
      : "never said yet.",
  };
}

/** What is wrong with a node's words, such that they never reach a run. Empty: nothing. */
export function wordsProblems(words: Json | undefined, mark?: string): string[] {
  if (typeof words !== "string" || !words.trim()) return ["it has no words"];
  const out: string[] = [];
  if (words.length > 1200) out.push(`its words run to ${words.length} characters; a node says one thing, in at most 1200`);
  if (mark && words.includes(mark)) out.push("its words carry the trial mark themselves");
  if (/\b[a-z]:[\\/]+users[\\/]+[^\\/\s"'`]+/i.test(words) || /(^|[\s"'`(])\/(users|home)\/[^/\s"'`]+/i.test(words)) out.push("its words name a person's home folder: a local path");
  if (/\b(sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|xox[abpr]-[a-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/i.test(words) || /\bbearer\s+[a-z0-9._-]{20,}/i.test(words)) {
    out.push("its words hold what looks like a secret");
  }
  return out;
}
