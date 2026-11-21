/**
 * Islands: an island holds together round its middle, and islands push
 * each other apart as wholes, so there is sea between them.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import { middle } from "../graph.ts";

const islands: Behaviour = {
  name: "islands",
  doc: "Each island holds together; islands keep sea between them.",
  on: true,
  dials: () => [
    weight("islands"),
    { key: "island_hold", label: "hold", min: 0, max: 0.3, step: 0.005, value: 0.05, doc: "How hard each particle is pulled to its island's middle." },
    { key: "island_apart", label: "apart", min: 0, max: 1, step: 0.01, value: 0.2, doc: "How hard two islands that are too near push apart, as wholes." },
    { key: "island_sea", label: "sea", min: 0, max: 4, step: 0.05, value: 1.5, doc: "How much sea two islands keep between them, as a share of their sizes." },
  ],
  apply(g, f, S) {
    const k = g.islands.length;
    const mid = g.islands.map((_, j) => middle(g, j));
    const reach = g.members.map((ms) => S.node_size! * S.island_spread! * Math.sqrt(ms.length + 1));
    const hold = S.island_hold!;
    for (let j = 0; j < k; j++) {
      const [mx, my] = mid[j]!;
      for (const i of g.members[j]!) {
        f.x[i]! += (mx - g.x[i]!) * hold;
        f.y[i]! += (my - g.y[i]!) * hold;
      }
    }
    for (let p = 0; p < k; p++) for (let q = p + 1; q < k; q++) {
      const dx = mid[q]![0] - mid[p]![0], dy = mid[q]![1] - mid[p]![1], d = Math.hypot(dx, dy) || 1e-6;
      const want = (reach[p]! + reach[q]!) * S.island_sea!;
      if (d >= want) continue;
      const push = (S.island_apart! * (want - d)) / d;
      for (const i of g.members[p]!) (f.x[i]! -= dx * push), (f.y[i]! -= dy * push);
      for (const i of g.members[q]!) (f.x[i]! += dx * push), (f.y[i]! += dy * push);
    }
  },
};

export default islands;
