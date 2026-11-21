/**
 * Collide: two particles never overlap. A pair nearer than their radii and
 * a gap is pushed apart, found through a grid. Firm: its push is not cooled
 * with the run, so particles an untangle move put together part even late.
 */
import { weight, type Behaviour } from "../behaviour.ts";

const collide: Behaviour = {
  name: "collide",
  doc: "Particles never overlap.",
  on: true,
  firm: true,
  dials: () => [
    weight("collide"),
    { key: "collide_gap", label: "gap", min: 0, max: 10, step: 0.1, value: 1.5, doc: "The room kept between two particles, in world units." },
    { key: "collide_k", label: "firmness", min: 0, max: 1, step: 0.01, value: 0.5, doc: "How much of an overlap is undone each step." },
  ],
  apply(g, f, S) {
    let rmax = 0;
    for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]!);
    const gap = S.collide_gap!, k = S.collide_k!;
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
        const d = Math.hypot(ox, oy, oz) || 1e-6, want = g.r[i]! + g.r[j]! + gap;
        if (d >= want) continue;
        const push = (k * (want - d)) / d / 2;
        f.x[i]! -= ox * push;
        f.y[i]! -= oy * push;
        f.z[i]! -= oz * push;
        f.x[j]! += ox * push;
        f.y[j]! += oy * push;
        f.z[j]! += oz * push;
      }
    }
  },
};

export default collide;
