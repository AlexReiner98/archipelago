/**
 * Flow: order links put a plan in columns, read left to right. A link
 * `from` waits on its `to` (depends_on, waits_on), so `to` comes first.
 * Each item an order link touches gets a rank: the longest chain of what
 * it waits on (a loop is cut where it closes). Each item is pulled along x
 * toward its rank's column, `flow_gap` apart, round the middle of the
 * items its order links reach; up and down are left to the other
 * behaviours. Items no order link touches feel nothing.
 *
 * Which link types order is a dial per type: on for depends_on,
 * waits_on and a run trail's after to start with.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";

/** The link types that order, to start with: a run's trail is in time order too (field/trail.ts `after`). */
const ORDER = new Set(["depends_on", "waits_on", "after"]);

export const flowKey = (type: string) => `flow_${type}`;

export interface Ranks {
  /** Each particle's rank, or -1 when no order link touches it. */
  rank: Int32Array;
  /** Each particle's group: the items order links join, or -1. */
  group: Int32Array;
  groups: number;
  /** Each group's mean rank. */
  mean: Float64Array;
}

/** Ranks and groups over the order links `on` marks by link kind. Pure. */
export function ranks(g: G, on: boolean[]): Ranks {
  const n = g.n, rank = new Int32Array(n).fill(-1), group = new Int32Array(n).fill(-1);
  const waits: number[][] = Array.from({ length: n }, () => []), next: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < g.m; e++) {
    if (!on[g.kind[e]!]) continue;
    const later = g.a[e]!, first = g.b[e]!;
    waits[later]!.push(first);
    next[first]!.push(later);
  }
  // Longest chain by Kahn's order; what a loop leaves unreached takes the deepest rank among what it waits on, plus one.
  const left = Int32Array.from(waits, (w) => w.length), queue: number[] = [];
  for (let i = 0; i < n; i++) if ((waits[i]!.length || next[i]!.length) && !left[i]) (rank[i] = 0), queue.push(i);
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h]!;
    for (const j of next[i]!) {
      rank[j] = Math.max(rank[j]!, rank[i]! + 1);
      if (!--left[j]!) queue.push(j);
    }
  }
  for (let i = 0; i < n; i++) if (rank[i] === -1 && (waits[i]!.length || next[i]!.length)) rank[i] = 1 + Math.max(0, ...waits[i]!.map((j) => rank[j]!));
  // Groups: what the order links join, either way.
  let groups = 0;
  for (let s = 0; s < n; s++) {
    if (rank[s] === -1 || group[s] !== -1) continue;
    const stack = [s];
    group[s] = groups;
    while (stack.length) {
      const i = stack.pop()!;
      for (const j of [...waits[i]!, ...next[i]!]) if (group[j] === -1) (group[j] = groups), stack.push(j);
    }
    groups++;
  }
  const mean = new Float64Array(groups), count = new Float64Array(groups);
  for (let i = 0; i < n; i++) if (group[i]! >= 0) (mean[group[i]!]! += rank[i]!), count[group[i]!]!++;
  for (let k = 0; k < groups; k++) mean[k]! /= count[k]!;
  return { rank, group, groups, mean };
}

/** Worked out once per graph and set of order kinds. */
const cache = new WeakMap<G, { key: string; r: Ranks }>();

/**
 * Each ordered particle and the x of its column. A group's columns sit round
 * its own mean x, and the columns' offsets sum to nothing, so pulling each
 * toward its column is the slope of half the pull times the gaps squared.
 */
function columns(g: G, S: Settings, on: (i: number, want: number) => void): void {
  const kinds = g.linkKinds.map((t) => (S[flowKey(t)] ?? (ORDER.has(t) ? 1 : 0)) > 0);
  if (!kinds.some(Boolean)) return;
  const key = kinds.join();
  let had = cache.get(g);
  if (!had || had.key !== key) cache.set(g, (had = { key, r: ranks(g, kinds) }));
  const { rank, group, groups, mean } = had.r;
  if (!groups) return;
  const mid = new Float64Array(groups), count = new Float64Array(groups);
  for (let i = 0; i < g.n; i++) if (group[i]! >= 0) (mid[group[i]!]! += g.x[i]!), count[group[i]!]!++;
  for (let i = 0; i < g.n; i++) {
    const gi = group[i]!;
    if (gi >= 0) on(i, mid[gi]! / count[gi]! + (rank[i]! - mean[gi]!) * S.flow_gap!);
  }
}

const flow: Behaviour = {
  name: "flow",
  doc: "Order links (depends_on) put a plan in columns: what it waits on to the left.",
  on: true,
  dials: ({ links }) => [
    weight("flow"),
    { key: "flow_gap", label: "column", min: 0, max: 300, step: 1, value: 60, doc: "How far apart two ranks' columns are, in world units." },
    { key: "flow_k", label: "pull", min: 0, max: 1, step: 0.01, value: 0.3, doc: "How hard each item is pulled along x toward its column, by its distance from it." },
    ...links.map((type) => ({ key: flowKey(type), label: "orders", group: type, min: 0, max: 1, step: 1, value: ORDER.has(type) ? 1 : 0, choices: ["no", "yes"], doc: `Whether a ${type} link puts its ends in order (its to on the left).` })),
  ],
  energy(g, S) {
    let u = 0;
    columns(g, S, (i, want) => (u += (S.flow_k! * (want - g.x[i]!) ** 2) / 2));
    return u;
  },
  apply(g, f, S) {
    columns(g, S, (i, want) => (f.x[i]! += (want - g.x[i]!) * S.flow_k!));
  },
};

export default flow;
