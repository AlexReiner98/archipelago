/**
 * Gather: a gentle pull of every island toward the middle of the map, so
 * repulsion does not scatter the archipelago across an empty sea. It moves
 * each island as a whole, by its middle, not each particle.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import { middle } from "../graph.ts";

const gather: Behaviour = {
  name: "gather",
  doc: "Islands drift toward the middle of the map.",
  on: true,
  dials: () => [
    weight("gather"),
    { key: "gather_k", label: "pull", min: 0, max: 0.05, step: 0.0005, value: 0.004, doc: "How hard each island is pulled toward the middle, by its distance from it." },
  ],
  apply(g, f, S) {
    const k = S.gather_k!;
    for (let j = 0; j < g.islands.length; j++) {
      const [mx, my] = middle(g, j);
      for (const i of g.members[j]!) {
        f.x[i]! -= mx * k;
        f.y[i]! -= my * k;
      }
    }
  },
};

export default gather;
