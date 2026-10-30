// Flow's own picture pulled tight: its rows and its crossings kept, the wires and boxes drawn in by ./settle.js. Tried
// behind the Plane form, to see what the pull alone does when no order wire can run up. Pure: an answer in, geometry out.

import { layout as flow } from './flow-layout.js';
import { settle, square } from './settle.js';

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;

export function layout(input) {
  const g = flow(input), { sizes } = input, gap = sizes.flow_node_gap, margin = sizes.flow_margin;
  const boxes = new Map(g.all.filter((n) => !n.dummy).map((n) => [n.id, { at: [g.x.get(n.id), g.y.get(n.id)], size: [n.w, n.h] }]));
  const wires = [...g.chains, ...g.ties].filter((w) => boxes.has(w.a) && boxes.has(w.b));
  for (const w of wires) w.points = w.points.map((p) => [...p]);
  const settled = square(wires) ? settle(boxes, wires, { gap: gap / 2, track: gap / 3 }) : null;
  for (const [id, b] of boxes) (g.x.set(id, b.at[0]), g.y.set(id, b.at[1]));
  const drawn = wires.flatMap((w) => w.points), steps = [...boxes.values()];
  g.width = Math.max(...steps.map((b) => b.at[0] + b.size[0] / 2), ...drawn.map((p) => p[0])) + margin;
  g.height = Math.max(...steps.map((b) => b.at[1] + b.size[1] / 2), ...drawn.map((p) => p[1])) + margin;
  last = { chains: g.chains, ties: g.ties, settled, width: g.width, height: g.height };
  return { ...g, breaks: [] };
}
