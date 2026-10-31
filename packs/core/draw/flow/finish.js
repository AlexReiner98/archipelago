// What stands, set out for drawing: each call starts from its own copy, sets what was put by hand on that, lands every wire
// on its outline and says the picture's size. Layer: metrics, its last step. Pure: places in, a layout's answer out.

import { runsUp } from './faults.js';
import { putByHand } from './hand.js';
import { pair } from './polyline.js';
import { landOn } from './shapes.js';

/** `placed` is where steps were put by hand. Answers with the layout and what the key says of it, in `seen`. */
export const finisher = ({ nodes, potential, chains: pulledChains, ties: pulledTies, x: pulledX, y: pulledY, routes: pulledRoutes, rigid: pulledRigid, holder, headless, sizes, z, margin, stepSize, tally }) => (placed) => {
  const x = new Map(pulledX), y = new Map(pulledY), routes = new Map([...pulledRoutes].map(([k, r]) => [k, { ...r, points: r.points.map((p) => [...p]) }]));
  const rigid = new Map([...pulledRigid].map(([id, b]) => [id, { ...b, at: [...b.at] }])), fresh = (w) => ({ ...w });
  const chains = pulledChains.map(fresh), ties = pulledTies.map(fresh), every = [...chains, ...ties];
  putByHand({ placed, nodes, x, y, every, routes, rigid, holder, lead: sizes.flow_lead_out, wiring: { track: z.turn, room: z.room, run: z.run, gap: z.turn, corner: z.corner, ports: sizes.plane_reroute_ports } });
  const edge = (id, to) => {
    const s = stepSize(id), [px, py] = [x.get(id), y.get(id)], dx = to[0] - px, dy = to[1] - py, t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
    return [px + dx * t, py + dy * t];
  };
  for (const w of every) {
    const r = routes.get(pair(w.a, w.b));
    w.points = r ? (r.from === w.a ? r.points : [...r.points].reverse()) : [edge(w.a, [x.get(w.b), y.get(w.b)]), edge(w.b, [x.get(w.a), y.get(w.a)])];
    w.headAt = 'end';
    // Each end on the outline that is drawn, not on the box round it.
    if (x.has(w.a) && x.has(w.b)) {
      const p = w.points, first = landOn(nodes.get(w.a), x.get(w.a), y.get(w.a), p[0], p[1]), final = landOn(nodes.get(w.b), x.get(w.b), y.get(w.b), p.at(-1), p.at(-2));
      w.points = p.map((q, i) => (i === 0 ? first : i === p.length - 1 ? final : q));
    }
  }
  const all = [...nodes.values()].filter((n) => x.has(n.id)), drawnPoints = every.flatMap((w) => w.points);
  const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
  const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
  const rectOf = (id) => { const n = nodes.get(id); return { l: x.get(id) - n.w / 2, r: x.get(id) + n.w / 2, t: y.get(id) - n.h / 2, u: y.get(id) + n.h / 2 }; };
  const headed = every.filter((w) => !headless.includes(w.type) && x.has(w.a) && x.has(w.b));
  return { laid: { nodes, all, chains, ties, breaks: [], potential, x, y, width, height }, seen: { chains, ties, ...tally, headed: headed.length, up: headed.filter((w) => runsUp(rectOf(w.a), rectOf(w.b), w.points)).length } };
};
