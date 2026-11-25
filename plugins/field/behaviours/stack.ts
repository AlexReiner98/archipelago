/**
 * Stack: stacking links hang a chain in a column, read top to bottom. A
 * link's `from` comes `stack_gap` straight below its `to`, so a chain a → b
 * → c stands as c, b, a down the page under the first. Where flow orders
 * along x, stack orders along y: a run's turns go left to right and each
 * turn's tool calls hang under it in order.
 *
 * Each particle in a chain is pulled to its row under the chain's head (the
 * one with nothing above it): straight below, its row times `stack_gap`
 * down. Held to the head, not to its neighbour, so a long chain stays a
 * straight column and never curls. Its energy is half `stack_k` times the
 * distance squared, and its push is that energy's slope on the particle and
 * the head. Which link types stack is a dial per type: on for a trail's
 * `then` (field/trail.ts) to start with.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";

/** The link types that stack, to start with. */
const STACK = new Set(["then"]);

export const stackKey = (type: string) => `stack_${type}`;

/** Each particle's chain head (-1: in no chain, or the head itself) and its row under it. Pure. */
export function rows(g: G, on: boolean[]): { head: Int32Array; row: Int32Array } {
  const above = new Int32Array(g.n).fill(-1);
  for (let e = 0; e < g.m; e++) if (on[g.kind[e]!] && above[g.a[e]!] === -1) above[g.a[e]!] = g.b[e]!;
  const head = new Int32Array(g.n).fill(-1), row = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    if (above[i] === -1) continue;
    // Up the chain to its top; a loop is cut after n steps.
    let j = i, d = 0;
    while (above[j] !== -1 && d < g.n) (j = above[j]!), d++;
    if (j !== i) (head[i] = j), (row[i] = d);
  }
  return { head, row };
}

/** Worked out once per graph and set of stacking kinds. */
const cache = new WeakMap<G, { key: string; r: ReturnType<typeof rows> }>();

/** Each stacked particle, its chain's head, and how far it is from its row under the head (dx, dy). */
function each(g: G, S: Settings, on: (a: number, h: number, dx: number, dy: number) => void): void {
  const kinds = g.linkKinds.map((t) => (S[stackKey(t)] ?? (STACK.has(t) ? 1 : 0)) > 0);
  if (!kinds.some(Boolean)) return;
  const key = kinds.join();
  let had = cache.get(g);
  if (!had || had.key !== key) cache.set(g, (had = { key, r: rows(g, kinds) }));
  const { head, row } = had.r;
  const gap = S.stack_gap!;
  for (let a = 0; a < g.n; a++) {
    const h = head[a]!;
    if (h < 0) continue;
    on(a, h, g.x[a]! - g.x[h]!, g.y[a]! - (g.y[h]! + row[a]! * gap));
  }
}

const stack: Behaviour = {
  name: "stack",
  doc: "Stacking links (a trail's then) hang a chain in a column: each under the one before.",
  on: true,
  dials: ({ links }) => [
    weight("stack"),
    { key: "stack_gap", label: "row", min: 0, max: 200, step: 1, value: 24, doc: "How far below the one before each link's from sits, in world units." },
    { key: "stack_k", label: "pull", min: 0, max: 1, step: 0.01, value: 0.3, doc: "How hard each end is pulled toward where the link would have it, by the distance." },
    ...links.map((type) => ({ key: stackKey(type), label: "stacks", group: type, min: 0, max: 1, step: 1, value: STACK.has(type) ? 1 : 0, choices: ["no", "yes"], doc: `Whether a ${type} link hangs its from under its to.` })),
  ],
  energy(g, S) {
    let u = 0;
    each(g, S, (_a, _b, dx, dy) => (u += (S.stack_k! * (dx * dx + dy * dy)) / 2));
    return u;
  },
  apply(g, f, S) {
    const k = S.stack_k!;
    each(g, S, (a, b, dx, dy) => {
      f.x[a]! -= k * dx;
      f.y[a]! -= k * dy;
      f.x[b]! += k * dx;
      f.y[b]! += k * dy;
    });
  },
};

export default stack;
