/**
 * One node's share of the window over a run, as pure parts: from each time
 * it was given or said (its pieces) and the run's compactions.
 *
 * | Stays | Its tokens in the window |
 * |---|---|
 * | `start` | its latest size, from the first time it was given: every request carries it, a compaction doesn't touch it |
 * | `listed` | what its listing holds: every part added, kept through a compaction |
 * | `said` | every piece since the last compaction: a compaction sums them up, and they leave |
 *
 * The steps are cut down to at most `points`, each the value at the end of
 * its stretch of time and the most it held in it, so a peak between two
 * compactions still shows.
 */

export type Stays = "start" | "listed" | "said";

export interface Piece {
  time?: string;
  tokens: number;
  /** Fitted to the model's real counts; else estimated. */
  fit?: boolean;
}

export interface Point {
  time: string;
  /** In the window at the end of this stretch. */
  tokens: number;
  /** The most in it during the stretch. */
  peak: number;
}

export interface Trend {
  stays: Stays;
  /** In the window at `until` (or the end). */
  now: number;
  /** Of `now`, fitted to the model's real counts; the rest estimated. */
  nowFitted: number;
  /** The most it ever held, by then. */
  peak: number;
  /** Everything it put in, by then: what a compaction dropped included. */
  total: number;
  /** Pieces by then; of them, how many are in the window. */
  count: number;
  inWindow: number;
  /** Dropped by compactions, by then. */
  dropped: number;
  first?: string;
  points: Point[];
}

/** The most points one trend answers. */
export const POINTS = 120;

const ms = (t: string | undefined) => (t ? Date.parse(t) : NaN);

export function trendOf(p: { pieces: readonly Piece[]; compactions: readonly string[]; stays: Stays; until?: string; points?: number }): Trend {
  const until = ms(p.until);
  const by = (t: string | undefined) => Number.isNaN(until) || Number.isNaN(ms(t)) || ms(t) <= until;
  type Step = { t: number; time: string; piece?: number; compact?: true };
  const steps: Step[] = [];
  p.pieces.forEach((x, i) => by(x.time) && steps.push({ t: Number.isNaN(ms(x.time)) ? -Infinity : ms(x.time), time: x.time ?? "", piece: i }));
  if (p.stays === "said") for (const c of p.compactions) if (by(c) && !Number.isNaN(ms(c))) steps.push({ t: ms(c), time: c, compact: true });
  // A compaction comes before what is said at the same moment: its summary is in the new window.
  steps.sort((a, b) => a.t - b.t || (a.compact ? -1 : 0) - (b.compact ? -1 : 0));

  let cur = 0;
  let curFit = 0;
  let peak = 0;
  let total = 0;
  let dropped = 0;
  let count = 0;
  let inWindow = 0;
  const raw: { t: number; time: string; tokens: number }[] = [];
  for (const s of steps) {
    if (s.compact) {
      dropped += cur;
      cur = 0;
      curFit = 0;
      inWindow = 0;
    } else {
      const x = p.pieces[s.piece!]!;
      const tok = x.tokens;
      total += tok;
      count++;
      if (p.stays === "start") {
        cur = tok;
        curFit = x.fit ? tok : 0;
        inWindow = 1;
      } else {
        cur += tok;
        if (x.fit) curFit += tok;
        inWindow++;
      }
    }
    peak = Math.max(peak, cur);
    if (s.time) raw.push({ t: s.t, time: s.time, tokens: cur });
  }
  const first = steps.find((s) => !s.compact && s.time)?.time;
  return { stays: p.stays, now: cur, nowFitted: curFit, peak, total, count, inWindow, dropped, ...(first ? { first } : {}), points: thin(raw, p.points ?? POINTS) };
}

/** At most `n` points: the value at the end of each stretch of time, and the most in it. */
function thin(raw: { t: number; time: string; tokens: number }[], n: number): Point[] {
  if (raw.length <= n) return raw.map((r) => ({ time: r.time, tokens: r.tokens, peak: r.tokens }));
  const a = raw[0]!.t;
  const span = Math.max(1, raw[raw.length - 1]!.t - a);
  const out: Point[] = [];
  let bucket = -1;
  for (const r of raw) {
    const b = Math.min(n - 1, Math.floor(((r.t - a) / span) * n));
    if (b !== bucket) {
      out.push({ time: r.time, tokens: r.tokens, peak: r.tokens });
      bucket = b;
    } else {
      const last = out[out.length - 1]!;
      last.time = r.time;
      last.tokens = r.tokens;
      last.peak = Math.max(last.peak, r.tokens);
    }
  }
  return out;
}
