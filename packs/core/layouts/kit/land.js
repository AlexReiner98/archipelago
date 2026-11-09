// A layout's places and wires finished for the scene (the kit, task e_7v52ek3c): each wire's ends landed on the outlines
// that are drawn (./shapes.js), but where it starts at a stop on a trunk or ends on one; where two cross, one passes
// under (./finish.js's `bridged`); and the picture's size. Answers the model the flow's scene draws (./index.js).
// Layer: metrics. Pure: places and wires in, the model out.

import { bridged } from './finish.js';
import { landOn } from './shapes.js';

/** The model: `nodes` (id to step), `x`, `y` (each step's middle), `chains` and `ties` with their points from a to b. */
export function finish({ nodes, x, y, chains, ties, potential = new Set(), margin, islands }) {
  const landed = (w) => {
    const p = w.points.map((q) => [...q]), n = p.length;
    if (n < 2) return { ...w, headAt: 'end', points: p };
    if (!w.stop && nodes.has(w.a) && x.has(w.a)) p[0] = landOn(nodes.get(w.a), x.get(w.a), y.get(w.a), p[0], p[1]);
    if (!w.toPort && nodes.has(w.b) && x.has(w.b)) p[n - 1] = landOn(nodes.get(w.b), x.get(w.b), y.get(w.b), p[n - 1], p[n - 2]);
    return { ...w, headAt: 'end', points: p };
  };
  const drawn = bridged({ chains: chains.map(landed), ties: ties.map(landed) });
  const all = [...nodes.values()].filter((n) => x.has(n.id));
  const points = [...drawn.chains, ...drawn.ties].flatMap((w) => w.points);
  const lands = (islands ?? []).flatMap((i) => i.land.map((r) => [r.r, r.b]));
  const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...points.map((p) => p[0]), ...lands.map((p) => p[0])) + margin;
  const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...points.map((p) => p[1]), ...lands.map((p) => p[1])) + margin;
  return { nodes, all, chains: drawn.chains, ties: drawn.ties, breaks: drawn.breaks, potential, x, y, width, height, ...(islands && { islands }) };
}
