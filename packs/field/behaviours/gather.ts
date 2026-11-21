/**
 * Gather: a gentle pull of every particle toward the middle of the map, so
 * repulsion does not scatter the map, and parts with no link between them
 * stay in sight of each other.
 */
import { weight, type Behaviour } from "../behaviour.ts";

const gather: Behaviour = {
  name: "gather",
  doc: "Particles drift toward the middle of the map.",
  on: true,
  dials: () => [
    weight("gather"),
    { key: "gather_k", label: "pull", min: 0, max: 0.05, step: 0.0005, value: 0.004, doc: "How hard each particle is pulled toward the middle, by its distance from it." },
  ],
  apply(g, f, S) {
    const k = S.gather_k!;
    for (let i = 0; i < g.n; i++) {
      f.x[i]! -= g.x[i]! * k;
      f.y[i]! -= g.y[i]! * k;
    }
  },
};

export default gather;
