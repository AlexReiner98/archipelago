/**
 * Repel: particles push each other apart, as charges, within their island.
 * Barnes-Hut over an octree, so a far crowd pushes as one particle at its
 * middle. Between islands the islands behaviour keeps the sea.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import { octree } from "../octree.ts";

const repel: Behaviour = {
  name: "repel",
  doc: "Particles push apart within their island.",
  on: true,
  dials: () => [
    weight("repel"),
    { key: "repel_strength", label: "charge", min: 0, max: 200, step: 1, value: 30, doc: "Each particle's charge: how hard it pushes the others away." },
    { key: "repel_theta", label: "far as one", min: 0.3, max: 1.5, step: 0.05, value: 0.9, doc: "Barnes-Hut: how far a crowd must be, for its size, to push as one particle. Higher is faster and rougher." },
    { key: "repel_near", label: "nearest", min: 0.5, max: 10, step: 0.5, value: 2, doc: "Under this distance, two particles push as if this far apart, so none flies off." },
  ],
  apply(g, f, S) {
    const q = new Float32Array(g.n).fill(S.repel_strength!);
    const th2 = S.repel_theta! ** 2, near2 = S.repel_near! ** 2;
    const stack: number[] = [];
    for (const ms of g.members) {
      if (ms.length < 2) continue;
      const t = octree(g, q, ms);
      for (const i of ms) {
        const xi = g.x[i]!, yi = g.y[i]!, zi = g.z[i]!;
        let fx = 0, fy = 0, fz = 0;
        stack.length = 0;
        stack.push(0);
        while (stack.length) {
          const c = stack.pop()!, mass = t.mass[c]!;
          if (!mass) continue;
          let dx = t.cx[c]! - xi, dy = t.cy[c]! - yi, dz = t.cz[c]! - zi, d2 = dx * dx + dy * dy + dz * dz;
          const size = t.size[c]!, leaf = t.leaf[c]!;
          if (leaf >= 0 || (size * size) / Math.max(d2, 1e-9) < th2) {
            const own = leaf === i ? q[i]! : 0;
            if (mass - own <= 0) continue;
            // Two on one spot: a fixed nudge, so the same answer settles the same way.
            if (d2 < near2) (dx = (i % 7) - 3 || 1), (dy = (i % 5) - 2 || 1), (dz = 0), (d2 = near2);
            const push = (mass - own) / d2;
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
