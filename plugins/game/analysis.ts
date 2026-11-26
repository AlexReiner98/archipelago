/**
 * A game in normal form, read and reasoned out. Pure: fields in, an
 * analysis out, the same on the server (`game.analyze`) and in the page
 * (the matrix view).
 *
 * - `readGame`: a game item's `players` and `payoffs` fields, checked,
 *   with what is wrong with them said rather than thrown.
 * - `analyze`: best responses, strictly and weakly dominated strategies
 *   (by a pure strategy), what survives their iterated removal, pure Nash
 *   equilibria, Pareto-optimal outcomes, and for a 2×2 game the fully
 *   mixed equilibrium.
 *
 * Bounded: at most MAX_PLAYERS players, MAX_STRATEGIES strategies each and
 * MAX_PROFILES outcomes in all.
 */
import type { Json } from "../../spec/common.ts";

export const MAX_PLAYERS = 6;
export const MAX_STRATEGIES = 24;
export const MAX_PROFILES = 1024;

/** A player: a name unique in its game, and what it can do, in order. */
export interface Player {
  name: string;
  strategies: string[];
}

/** One outcome: a strategy per player, and what it is worth to each, both in player order. */
export interface Cell {
  profile: string[];
  payoff: number[];
}

export interface Game {
  players: Player[];
  payoffs: Cell[];
}

/** A game's fields read, with what in them doesn't fit. */
export interface Read extends Game {
  problems: string[];
}

const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);

/** The players and payoffs of a game item, as far as they make sense. */
export function readGame(fields: Record<string, Json | undefined>): Read {
  const problems: string[] = [];
  const players: Player[] = [];
  const raw = fields.players;
  if (raw !== undefined && !Array.isArray(raw)) problems.push("players is not a list.");
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!isObj(p) || typeof p.name !== "string" || !p.name.trim()) {
      problems.push(`A player without a name: ${JSON.stringify(p)}.`);
      continue;
    }
    if (players.some((q) => q.name === p.name)) {
      problems.push(`Two players named ${p.name}.`);
      continue;
    }
    const s = Array.isArray(p.strategies) ? p.strategies.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    players.push({ name: p.name, strategies: [...new Set(s)] });
  }
  const payoffs: Cell[] = [];
  const seen = new Set<string>();
  const cells = fields.payoffs;
  if (cells !== undefined && !Array.isArray(cells)) problems.push("payoffs is not a list.");
  for (const c of Array.isArray(cells) ? cells : []) {
    const profile = isObj(c) && Array.isArray(c.profile) ? c.profile : null;
    const payoff = isObj(c) && Array.isArray(c.payoff) ? c.payoff : null;
    if (!profile || !payoff || profile.length !== players.length || payoff.length !== players.length) {
      problems.push(`A payoff that doesn't fit the players: ${JSON.stringify(c)}.`);
      continue;
    }
    if (profile.some((s, i) => typeof s !== "string" || !players[i]!.strategies.includes(s))) {
      problems.push(`A payoff for a strategy no player has: ${JSON.stringify(profile)}.`);
      continue;
    }
    if (payoff.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      problems.push(`A payoff that isn't numbers: ${JSON.stringify(payoff)}.`);
      continue;
    }
    const key = JSON.stringify(profile);
    if (seen.has(key)) {
      problems.push(`Two payoffs for ${profile.join(", ")}: the first is kept.`);
      continue;
    }
    seen.add(key);
    payoffs.push({ profile: profile as string[], payoff: payoff as number[] });
  }
  return { players, payoffs, problems };
}

/** A word that changes when the game does: its players and payoffs, hashed (FNV-1a). An explanation is of a version. */
export function versionOf(game: Game): string {
  const s = JSON.stringify({ players: game.players, payoffs: game.payoffs });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** How many outcomes the game has: the product of each player's strategies. */
export const size = (players: Player[]): number => (players.length ? players.reduce((n, p) => n * p.strategies.length, 1) : 0);

/** Every outcome, the first player's strategy changing slowest. */
export function profiles(players: Player[]): string[][] {
  let out: string[][] = [[]];
  for (const p of players) out = out.flatMap((pre) => p.strategies.map((s) => [...pre, s]));
  return players.length ? out : [];
}

/** What is too big about a game, or undefined. */
export function tooBig(players: Player[]): string | undefined {
  if (players.length > MAX_PLAYERS) return `A game has at most ${MAX_PLAYERS} players.`;
  const wide = players.find((p) => p.strategies.length > MAX_STRATEGIES);
  if (wide) return `${wide.name} has ${wide.strategies.length} strategies; at most ${MAX_STRATEGIES}.`;
  if (size(players) > MAX_PROFILES) return `The game has ${size(players)} outcomes; at most ${MAX_PROFILES}.`;
  return undefined;
}

/** A player's best strategies against one choice of the others'. */
export interface BestResponse {
  player: string;
  /** The others' strategies, in player order, with null at this player's place. */
  against: (string | null)[];
  best: string[];
}

/** A strategy beaten by another of the same player's, whatever the others do. */
export interface Dominated {
  player: string;
  strategy: string;
  by: string;
  /** Strictly worse against everything, or never better and sometimes worse. */
  strictly: boolean;
}

export interface Equilibrium {
  profile: string[];
  payoff: number[];
  /** Another outcome every player likes at least as well, and one better. */
  pareto_dominated_by?: string[];
}

/** A 2×2 game's fully mixed equilibrium: each player's chances of each strategy, and what each expects. */
export interface Mixed {
  mix: Record<string, number>[];
  expected: number[];
}

export interface Analysis {
  players: string[];
  /** Every outcome has a payoff. Without that, only `missing` is said. */
  complete: boolean;
  missing: string[][];
  best_responses: BestResponse[];
  dominated: Dominated[];
  /** Each player's strategies left after strictly dominated ones are removed, again and again. */
  survives: Record<string, string[]>;
  nash: Equilibrium[];
  pareto: string[][];
  /** Only for two players with two strategies each: null when there is no fully mixed one (or there are infinitely many). */
  mixed?: Mixed | null;
  /** The reasoning in a few lines. */
  summary: string[];
}

const MISSING_SHOWN = 20;
const round = (x: number) => Math.round(x * 10000) / 10000;
const fmt = (x: number) => String(round(x));
const show = (p: string[]) => `(${p.join(", ")})`;

/** Reasons a game out. A game with missing payoffs gets only what is missing. */
export function analyze(game: Game): Analysis {
  const { players } = game;
  const names = players.map((p) => p.name);
  const empty: Analysis = { players: names, complete: false, missing: [], best_responses: [], dominated: [], survives: {}, nash: [], pareto: [], summary: [] };
  const big = tooBig(players);
  if (big) return { ...empty, summary: [big] };
  if (players.length < 2 || players.some((p) => !p.strategies.length)) {
    const short = players.length < 2 ? "A game needs two players or more." : `${players.filter((p) => !p.strategies.length).map((p) => p.name).join(", ")} has no strategy yet.`;
    return { ...empty, summary: [short] };
  }
  const table = new Map<string, number[]>();
  for (const c of game.payoffs) table.set(JSON.stringify(c.profile), c.payoff);
  const all = profiles(players);
  const missing = all.filter((p) => !table.has(JSON.stringify(p)));
  if (missing.length) {
    return {
      ...empty,
      missing: missing.slice(0, MISSING_SHOWN),
      summary: [`${missing.length} of ${all.length} outcomes have no payoff yet, such as ${show(missing[0]!)}.`],
    };
  }
  const u = (p: string[]) => table.get(JSON.stringify(p))!;
  const swap = (p: string[], i: number, s: string) => p.map((x, j) => (j === i ? s : x));

  // The others' choices, for player i: every outcome with i's place left null.
  const othersOf = (i: number, within: Player[] = players): (string | null)[][] =>
    profiles(within.map((p, j) => (j === i ? { ...p, strategies: [p.strategies[0]!] } : p))).map((p) => p.map((x, j) => (j === i ? null : x)));
  const at = (o: (string | null)[], i: number, s: string) => o.map((x, j) => (j === i ? s : x)) as string[];

  const best_responses: BestResponse[] = [];
  players.forEach((p, i) => {
    for (const o of othersOf(i)) {
      const vals = p.strategies.map((s) => u(at(o, i, s))[i]!);
      const top = Math.max(...vals);
      best_responses.push({ player: p.name, against: o, best: p.strategies.filter((_, k) => vals[k] === top) });
    }
  });

  /** Strategies of player i dominated by another, among the outcomes `within` allows. */
  const dominatedIn = (within: Player[], i: number): Dominated[] => {
    const out: Dominated[] = [];
    const os = othersOf(i, within);
    for (const s of within[i]!.strategies) {
      let found: Dominated | undefined;
      for (const t of within[i]!.strategies) {
        if (t === s) continue;
        let strict = true;
        let weak = true;
        let some = false;
        for (const o of os) {
          const a = u(at(o, i, s))[i]!;
          const b = u(at(o, i, t))[i]!;
          if (b <= a) strict = false;
          if (b < a) weak = false;
          if (b > a) some = true;
        }
        if (strict) {
          found = { player: within[i]!.name, strategy: s, by: t, strictly: true };
          break;
        }
        if (weak && some && !found) found = { player: within[i]!.name, strategy: s, by: t, strictly: false };
      }
      if (found) out.push(found);
    }
    return out;
  };
  const dominated = players.flatMap((_, i) => dominatedIn(players, i));

  // Iterated removal of strictly dominated strategies: one at a time, until none is.
  let left = players.map((p) => ({ ...p, strategies: [...p.strategies] }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < left.length && !changed; i++) {
      const d = dominatedIn(left, i).find((x) => x.strictly);
      if (d) {
        left = left.map((p, j) => (j === i ? { ...p, strategies: p.strategies.filter((s) => s !== d.strategy) } : p));
        changed = true;
      }
    }
  }
  const survives = Object.fromEntries(left.map((p) => [p.name, p.strategies]));

  const paretoBy = (p: string[]): string[] | undefined => {
    const a = u(p);
    return all.find((q) => {
      const b = u(q);
      return b.every((x, k) => x >= a[k]!) && b.some((x, k) => x > a[k]!);
    });
  };
  const pareto = all.filter((p) => !paretoBy(p));
  const nash: Equilibrium[] = all
    .filter((p) => players.every((pl, i) => pl.strategies.every((s) => u(swap(p, i, s))[i]! <= u(p)[i]!)))
    .map((p) => {
      const by = paretoBy(p);
      return { profile: p, payoff: u(p), ...(by ? { pareto_dominated_by: by } : {}) };
    });

  const two = players.length === 2 && players.every((p) => p.strategies.length === 2);
  const mixed = two ? mixed2x2(players, u) : undefined;

  const summary: string[] = [];
  summary.push(
    nash.length
      ? `Pure equilibria: ${nash.map((e) => `${show(e.profile)} paying ${e.payoff.join(", ")}`).join("; ")}.`
      : "No pure-strategy equilibrium: every outcome leaves someone a better move.",
  );
  for (const d of dominated) summary.push(`${d.player}: ${d.strategy} is ${d.strictly ? "strictly" : "weakly"} dominated by ${d.by}.`);
  const cut = players.filter((p) => survives[p.name]!.length < p.strategies.length);
  if (cut.length) summary.push(`Removing strictly dominated strategies again and again leaves ${players.map((p) => `${p.name} ${survives[p.name]!.join(" or ")}`).join("; ")}.`);
  for (const e of nash) if (e.pareto_dominated_by) summary.push(`${show(e.profile)} is an equilibrium, yet every player does at least as well at ${show(e.pareto_dominated_by)}: a dilemma.`);
  if (two) {
    summary.push(
      mixed
        ? `Mixed: ${mixed.mix.map((m, i) => `${names[i]} plays ${Object.entries(m).map(([s, x]) => `${s} ${fmt(x)}`).join(", ")}`).join("; ")}; each expects ${mixed.expected.map(fmt).join(", ")}.`
        : "Mixed: no fully mixed equilibrium (or a continuum of them).",
    );
  }
  return { players: names, complete: true, missing: [], best_responses, dominated, survives, nash, pareto, ...(two ? { mixed } : {}), summary };
}

/**
 * A 2×2 game's fully mixed equilibrium. The row player mixes so that the
 * column player is indifferent, and the other way about.
 */
function mixed2x2(players: Player[], u: (p: string[]) => number[]): Mixed | null {
  const [r0, r1] = players[0]!.strategies as [string, string];
  const [c0, c1] = players[1]!.strategies as [string, string];
  const A = (r: string, c: string) => u([r, c])[0]!;
  const B = (r: string, c: string) => u([r, c])[1]!;
  const dp = B(r0, c0) - B(r1, c0) - B(r0, c1) + B(r1, c1);
  const dq = A(r0, c0) - A(r0, c1) - A(r1, c0) + A(r1, c1);
  if (dp === 0 || dq === 0) return null;
  const p = (B(r1, c1) - B(r1, c0)) / dp;
  const q = (A(r1, c1) - A(r0, c1)) / dq;
  if (!(p > 0 && p < 1 && q > 0 && q < 1)) return null;
  return {
    mix: [
      { [r0]: round(p), [r1]: round(1 - p) },
      { [c0]: round(q), [c1]: round(1 - q) },
    ],
    expected: [round(q * A(r0, c0) + (1 - q) * A(r0, c1)), round(p * B(r0, c0) + (1 - p) * B(r1, c0))],
  };
}
