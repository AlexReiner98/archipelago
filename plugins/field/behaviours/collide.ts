/**
 * Collide: two particles never overlap. A pair nearer than their edges and
 * a gap is pushed apart, found through a grid. Its energy is a quarter of
 * the firmness times each overlap, squared. With shapes on (the drawing's
 * `shapes` dial), each edge is its shape's along the line between the two
 * (shapes.ts), so a square's flat side plugins closer than its corner.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";
import { CIRCLE, edge, edgeSlope, reach } from "../shapes.ts";

/**
 * Each pair nearer than its edges and the gap, found through a grid: i, j,
 * j's offset from i, their distance, the distance they want, and how fast
 * that changes as the pair turns (0 for two circles).
 */
function overlaps(g: G, S: Settings, on: (i: number, j: number, ox: number, oy: number, oz: number, d: number, want: number, turn: number) => void): void {
  const shaped = !!S.shapes;
  let rmax = 0;
  for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]! * (shaped ? reach(g.shape[i]!) : 1));
  const gap = S.collide_gap!;
  const cell = 2 * rmax + gap;
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx * 73856093) ^ (cy * 19349663);
  for (let i = 0; i < g.n; i++) {
    const kk = key(Math.floor(g.x[i]! / cell), Math.floor(g.y[i]! / cell));
    let list = cells.get(kk);
    if (!list) cells.set(kk, (list = []));
    list.push(i);
  }
  for (let i = 0; i < g.n; i++) {
    const cx = Math.floor(g.x[i]! / cell), cy = Math.floor(g.y[i]! / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of cells.get(key(cx + dx, cy + dy)) ?? []) {
      if (j <= i) continue;
      const ox = g.x[j]! - g.x[i]!, oy = g.y[j]! - g.y[i]!, oz = g.z[j]! - g.z[i]!;
      const d = Math.hypot(ox, oy, oz) || 1e-6;
      let want = g.r[i]! + g.r[j]! + gap, turn = 0;
      if (shaped && (g.shape[i] !== CIRCLE || g.shape[j] !== CIRCLE)) {
        const th = Math.atan2(oy, ox);
        want = g.r[i]! * edge(g.shape[i]!, th) + g.r[j]! * edge(g.shape[j]!, th + Math.PI) + gap;
        turn = g.r[i]! * edgeSlope(g.shape[i]!, th) + g.r[j]! * edgeSlope(g.shape[j]!, th + Math.PI);
      }
      if (d < want) on(i, j, ox, oy, oz, d, want, turn);
    }
  }
}

const collide: Behaviour = {
  name: "collide",
  doc: "Particles never overlap.",
  on: true,
  dials: () => [
    weight("collide"),
    { key: "collide_gap", label: "gap", min: 0, max: 10, step: 0.1, value: 1.5, doc: "The room kept between two particles, in world units." },
    { key: "collide_k", label: "firmness", min: 0, max: 1, step: 0.01, value: 0.5, doc: "How hard an overlap pushes the two apart." },
  ],
  energy(g, S) {
    let u = 0;
    overlaps(g, S, (_i, _j, _ox, _oy, _oz, d, want) => (u += (S.collide_k! * (want - d) ** 2) / 4));
    return u;
  },
  apply(g, f, S) {
    // Apart along the line between them; and, for shapes, round each other toward where their edges leave more room.
    overlaps(g, S, (i, j, ox, oy, oz, d, want, turn) => {
      const push = (S.collide_k! * (want - d)) / d / 2, side = (push * turn) / d;
      const fx = ox * push + oy * side, fy = oy * push - ox * side, fz = oz * push;
      f.x[i]! -= fx;
      f.y[i]! -= fy;
      f.z[i]! -= fz;
      f.x[j]! += fx;
      f.y[j]! += fy;
      f.z[j]! += fz;
    });
  },
};

export default collide;
