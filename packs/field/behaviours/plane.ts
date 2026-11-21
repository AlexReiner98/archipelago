/**
 * Plane: pulls every particle back to z = 0, softly while the run is warm
 * and harder as it cools, so links can pass over one another in depth early
 * on and the map ends flat. Off by default: turn it on with a depth seed to
 * run in 3D, seen from above.
 */
import { weight, type Behaviour } from "../behaviour.ts";

const plane: Behaviour = {
  name: "plane",
  doc: "A 3D run is pulled flat as it cools.",
  on: false,
  dials: () => [
    weight("plane"),
    { key: "plane_k", label: "pull", min: 0, max: 0.1, step: 0.001, value: 0.01, doc: "How hard a particle is pulled back to the plane." },
    { key: "plane_cool", label: "harder as it cools", min: 0, max: 3, step: 0.05, value: 1.5, doc: "How much faster the pull grows as the run cools (the pull is divided by warmth to this power)." },
    { key: "depth_seed", label: "start depth", min: 0, max: 2, step: 0.05, value: 0.5, then: "seed", doc: "How far out of the plane particles start, as a share of their island's size." },
  ],
  apply(g, f, S, sim) {
    const k = S.plane_k! / Math.max(0.02, sim.alpha) ** S.plane_cool!;
    for (let i = 0; i < g.n; i++) f.z[i]! -= g.z[i]! * k;
  },
};

export default plane;
