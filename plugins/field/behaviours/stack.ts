/**
 * Stack: stacking links lay what they join out as a grid. A link stacks
 * `down` or `across`: its `from` comes one row below its `to`, or one column
 * to the right. Following them up from any particle reaches the grid's root
 * (the one with nothing above or before it), and the steps taken give the
 * particle's cell: so many columns right and rows down from the root. A
 * run's trail is one grid this way: its turns across (`after`), each turn's
 * calls down under it (`then`).
 *
 * Each particle is pulled to its cell in the grid as a whole (where the
 * grid stands is its members' mean, each less its cell's offset), never to
 * its neighbour: a long column can't curl, and its weight never drags its
 * turn off the row, as it would hanging from it. Its energy is half
 * `stack_k` times the distance to its cell squared. The distances in a grid
 * sum to nothing, so each particle's push is `stack_k` times its own
 * distance alone, and no one particle bears the others' pull. Which way a
 * link type stacks is a dial per type: a trail's `then` down and `after`
 * across to start with.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";

/** How each link type stacks, to start with: 1 down, 2 across. */
const STACK: Record<string, number> = { then: 1, after: 2 };
const WAYS = ["no", "down", "across"];

export const stackKey = (type: string) => `stack_${type}`;

/** Each particle's grid root (-1: in no grid, or the root itself) and its cell from it, in columns and rows. Pure. */
export function cells(g: G, way: number[]): { root: Int32Array; col: Int32Array; row: Int32Array } {
  // Each particle's one link up the grid: the first stacking link from it.
  const up = new Int32Array(g.n).fill(-1), dir = new Int8Array(g.n);
  for (let e = 0; e < g.m; e++) {
    const w = way[g.kind[e]!]!;
    if (w && up[g.a[e]!] === -1) (up[g.a[e]!] = g.b[e]!), (dir[g.a[e]!] = w);
  }
  const root = new Int32Array(g.n).fill(-1), col = new Int32Array(g.n), row = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) {
    if (up[i] === -1) continue;
    // Up to the root, counting the steps each way; a loop is cut after n steps.
    let j = i, c = 0, r = 0, d = 0;
    while (up[j] !== -1 && d++ < g.n) {
      if (dir[j] === 1) r++;
      else c++;
      j = up[j]!;
    }
    if (j !== i) (root[i] = j), (col[i] = c), (row[i] = r);
  }
  return { root, col, row };
}

/** Worked out once per graph and set of ways. */
const cache = new WeakMap<G, { key: string; r: ReturnType<typeof cells> }>();

/**
 * Each particle in a grid (the root too) and how far it is from its cell (dx, dy). Where the grid stands is
 * its members' mean, each less its cell's offset: so the distances in a grid sum to nothing, and no one
 * particle (the root) bears the others' pull.
 */
function each(g: G, S: Settings, on: (a: number, dx: number, dy: number) => void): void {
  const way = g.linkKinds.map((t) => Math.round(S[stackKey(t)] ?? STACK[t] ?? 0));
  if (!way.some(Boolean)) return;
  const key = way.join();
  let had = cache.get(g);
  if (!had || had.key !== key) cache.set(g, (had = { key, r: cells(g, way) }));
  const { root, col, row } = had.r;
  const gx = S.stack_col!, gy = S.stack_row!;
  // Each grid by its root: the sum of its members' positions less their offsets, and how many.
  const sx = new Map<number, number>(), sy = new Map<number, number>(), count = new Map<number, number>();
  for (let a = 0; a < g.n; a++) {
    const h = root[a]!;
    if (h < 0) continue;
    if (!count.has(h)) sx.set(h, g.x[h]!), sy.set(h, g.y[h]!), count.set(h, 1);
    sx.set(h, sx.get(h)! + g.x[a]! - col[a]! * gx), sy.set(h, sy.get(h)! + g.y[a]! - row[a]! * gy), count.set(h, count.get(h)! + 1);
  }
  for (const [h, n] of count) on(h, g.x[h]! - sx.get(h)! / n, g.y[h]! - sy.get(h)! / n);
  for (let a = 0; a < g.n; a++) {
    const h = root[a]!;
    if (h < 0) continue;
    const n = count.get(h)!;
    on(a, g.x[a]! - col[a]! * gx - sx.get(h)! / n, g.y[a]! - row[a]! * gy - sy.get(h)! / n);
  }
}

const stack: Behaviour = {
  name: "stack",
  doc: "Stacking links (a trail's after and then) lay what they join out as a grid: across, then down.",
  on: true,
  dials: ({ links }) => [
    weight("stack"),
    { key: "stack_col", label: "column", min: 0, max: 400, step: 1, value: 140, doc: "How far apart two columns of a grid are, in world units: room for a call's name." },
    { key: "stack_row", label: "row", min: 0, max: 200, step: 1, value: 24, doc: "How far apart two rows of a grid are, in world units." },
    { key: "stack_k", label: "pull", min: 0, max: 1, step: 0.01, value: 0.5, doc: "How hard each particle is pulled toward its cell, by its distance from it." },
    ...links.map((type) => ({ key: stackKey(type), label: "stacks", group: type, min: 0, max: 2, step: 1, value: STACK[type] ?? 0, choices: WAYS, doc: `Whether a ${type} link puts its from below its to (down), to its right (across), or neither.` })),
  ],
  energy(g, S) {
    let u = 0;
    each(g, S, (_a, dx, dy) => (u += (S.stack_k! * (dx * dx + dy * dy)) / 2));
    return u;
  },
  apply(g, f, S) {
    each(g, S, (a, dx, dy) => ((f.x[a]! -= S.stack_k! * dx), (f.y[a]! -= S.stack_k! * dy)));
  },
};

export default stack;
