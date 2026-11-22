/**
 * Repel: particles push each other apart, as charges. Barnes-Hut over an
 * octree, so a far crowd pushes as one particle at its middle. The push
 * is the charge over the distance, less the charge times the distance over
 * the reach squared, so it fades to nothing at the reach instead of
 * stopping there (a push that stops dead keeps particles at the edge
 * trembling). Its energy is the charge times (half of (d/reach)² less one,
 * less the log of d/reach), and nothing past reach.
 */
import { weight, type Behaviour, type Force } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";
import { octree } from "../octree.ts";

/** Every pair nearer than the reach, exactly, through a grid of cells the reach across: the energy's own slope. */
function exact(g: G, f: Force, S: Settings): void {
  const q = S.repel_strength!, far = S.repel_far!, far2 = far * far, fade = 1 / far2, near2 = S.repel_near! ** 2;
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  for (let i = 0; i < g.n; i++) {
    const k = key(Math.floor(g.x[i]! / far), Math.floor(g.y[i]! / far));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  for (let i = 0; i < g.n; i++) {
    const xi = g.x[i]!, yi = g.y[i]!, zi = g.z[i]!, cx = Math.floor(xi / far), cy = Math.floor(yi / far);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const list = cells.get(key(cx + dx, cy + dy));
      if (!list) continue;
      for (const j of list) {
        if (j <= i) continue;
        const ox = g.x[j]! - xi, oy = g.y[j]! - yi, oz = g.z[j]! - zi, d2 = ox * ox + oy * oy + oz * oz;
        // Nearer than `nearest`, the energy is flat (collide keeps them apart): no push.
        if (d2 >= far2 || d2 < near2) continue;
        const push = q * (1 / d2 - fade);
        f.x[i]! -= ox * push;
        f.y[i]! -= oy * push;
        f.z[i]! -= oz * push;
        f.x[j]! += ox * push;
        f.y[j]! += oy * push;
        f.z[j]! += oz * push;
      }
    }
  }
}

const repel: Behaviour = {
  name: "repel",
  doc: "Particles push each other apart.",
  on: true,
  dials: () => [
    weight("repel"),
    { key: "repel_strength", label: "charge", min: 0, max: 200, step: 1, value: 30, doc: "Each particle's charge: how hard it pushes the others away." },
    { key: "repel_exact", label: "every pair", min: 0, max: 1, step: 1, value: 1, choices: ["Barnes-Hut", "within reach"], doc: "Within reach: every pair nearer than the reach pushes exactly, found through a grid, so the run settles fully. Barnes-Hut: a far crowd pushes as one, faster on a big map but never quite still (with no reach, always Barnes-Hut)." },
    { key: "repel_theta", label: "far as one", min: 0.3, max: 1.5, step: 0.05, value: 0.7, doc: "Barnes-Hut: how far a crowd must be, for its size, to push as one particle. Higher is faster and rougher." },
    { key: "repel_far", label: "reach", min: 0, max: 2000, step: 10, value: 400, doc: "Particles further apart than this do not push each other (0: no limit), so gather can bring clusters together." },
    { key: "repel_near", label: "nearest", min: 0.5, max: 10, step: 0.5, value: 2, doc: "Under this distance, two particles push as if this far apart, so none flies off." },
  ],
  // Every pair, as the push would be without Barnes-Hut.
  energy(g, S) {
    const q = S.repel_strength!, near = S.repel_near!, far = S.repel_far! > 0 ? S.repel_far! : Infinity;
    let u = 0;
    for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) {
      const d = Math.max(near, Math.hypot(g.x[j]! - g.x[i]!, g.y[j]! - g.y[i]!, g.z[j]! - g.z[i]!));
      if (far === Infinity) u -= q * Math.log(d);
      else if (d < far) u += q * (((d / far) ** 2 - 1) / 2 - Math.log(d / far));
    }
    return u;
  },
  apply(g, f, S) {
    if (S.repel_exact && S.repel_far! > 0) return exact(g, f, S);
    const q = new Float32Array(g.n).fill(S.repel_strength!);
    const th2 = S.repel_theta! ** 2, near2 = S.repel_near! ** 2, far2 = S.repel_far! > 0 ? S.repel_far! ** 2 : Infinity, fade = 1 / far2;
    const stack: number[] = [];
    if (g.n < 2) return;
    const all = Array.from({ length: g.n }, (_, i) => i);
    const t = octree(g, q, all);
    {
      for (let i = 0; i < g.n; i++) {
        const xi = g.x[i]!, yi = g.y[i]!, zi = g.z[i]!;
        let fx = 0, fy = 0, fz = 0;
        stack.length = 0;
        stack.push(0);
        while (stack.length) {
          const c = stack.pop()!, mass = t.mass[c]!;
          if (!mass) continue;
          let dx = t.cx[c]! - xi, dy = t.cy[c]! - yi, dz = t.cz[c]! - zi, d2 = dx * dx + dy * dy + dz * dz;
          const size = t.size[c]!, leaf = t.leaf[c]!;
          // A cell wholly out of reach pushes nothing.
          if (d2 > far2 && Math.sqrt(d2) - size * 0.87 > Math.sqrt(far2)) continue;
          if (leaf >= 0 || (size * size) / Math.max(d2, 1e-9) < th2) {
            if (d2 > far2) continue;
            const own = leaf === i ? q[i]! : 0;
            if (mass - own <= 0) continue;
            // Two on one spot: a fixed nudge, so the same answer settles the same way.
            if (d2 < near2) (dx = (i % 7) - 3 || 1), (dy = (i % 5) - 2 || 1), (dz = 0), (d2 = near2);
            const push = (mass - own) * (1 / d2 - fade);
            fx -= dx * push;
            fy -= dy * push;
            fz -= dz * push;
          } else for (let k = 0; k < 8; k++) {
            const kid = t.kid[c * 8 + k]!;
            if (kid >= 0) stack.push(kid);
          }
        }
        f.x[i]! += fx;
        f.y[i]! += fy;
        f.z[i]! += fz;
      }
    }
  },
};

export default repel;
