// One strip (task e_3svu8hbh, after Hamilton Ulmer's sorted rows and the strip maps of a subway line): every step a row
// of its own, in the kit's order (./model.js), each at the strip's left edge; every link a lane down a gutter beside
// them, the links that run down the order in the gutter on the right and those that run up it, dashed, in the gutter
// on the left. Each gutter's lanes are packed by the left-edge method, shortest nearest the steps (./lanes.js). A step
// with many links on one side is a hub: those are one lane with a stop at each, their wires sharing it as a trunk
// (./bundle.js). Each end has a port of its own on its step's side, set so a step's own wires cross none of each other,
// and a step grows to hold its ports a wire apart. Layer: metrics. Pure: the kit's graph in, places and wires out.

import { bundle } from './bundle.js';
import { lanes } from './lanes.js';
import { stage } from './stage.js';

const SIDES = ['left', 'right'];

/**
 * The strip of graph `m` (./model.js): `outside` names ends that leave it at a side for the sea ({ key, id, side, up }).
 * Answers `x` and `y` (each step's middle), `chains` and `ties` with their points, `ports` (each outside end's point
 * on its step) and `extent` ({ l, t, r, b }).
 */
export function strip(m, { sizes, outside = [] }) {
  const WIRE = sizes.flow_wire_gap, ROOM = sizes.flow_wire_room, GAP = sizes.strips_row_gap, HUB = sizes.strips_hub;
  const { nodes, rank, order, against } = m;
  const wires = [...m.chains.map((w) => ({ ...w, kind: 'chain' })), ...m.ties.map((w) => ({ ...w, kind: 'tie' }))].filter((w) => nodes.has(w.a) && nodes.has(w.b));
  for (const w of wires) {
    w.side = against(w) ? 'left' : 'right';
    if (w.side === 'left') w.dashed = true;
  }
  // Hubs: on each side, the step with the most links there takes them all as one lane, while it has `HUB` left.
  const groups = [];
  for (const side of SIDES) {
    const free = new Set(wires.filter((w) => w.side === side));
    const count = (id) => [...free].filter((w) => w.a === id || w.b === id).length;
    for (;;) {
      const best = order.reduce((b, id) => (count(id) > (b ? count(b) : 0) ? id : b), null);
      if (!best || count(best) < HUB) break;
      const mine = [...free].filter((w) => w.a === best || w.b === best);
      mine.forEach((w) => (free.delete(w), (w.hub = w.a === best ? 'a' : 'b')));
      groups.push({ side, hub: best, wires: mine });
    }
    for (const w of free) groups.push({ side, wires: [w] });
  }
  const ends = (g) => [...new Set(g.wires.flatMap((w) => [w.a, w.b]))];
  // Each side's lanes, by the rows each group spans.
  for (const side of SIDES) {
    const mine = groups.filter((g) => g.side === side), spans = mine.map((g) => { const r = ends(g).map((id) => rank.get(id)); return [Math.min(...r), Math.max(...r)]; });
    const { lane } = lanes(spans, 1);
    mine.forEach((g, k) => (g.lane = lane[k]));
  }
  stage('lanes', { groups: groups.map((g) => ({ side: g.side, lane: g.lane, hub: g.hub ?? null, links: g.wires.map((w) => [w.a, w.b]) })) });
  // Each step's ends on each side: up (the other end above) by lane outward, then those both ways, then down by lane inward.
  const portsOf = new Map(order.map((id) => [id, { left: [], right: [] }]));
  for (const g of groups) for (const id of ends(g)) {
    const others = g.hub && id === g.hub ? ends(g).filter((o) => o !== id) : g.wires.filter((w) => w.a === id || w.b === id).map((w) => (w.a === id ? w.b : w.a));
    const ups = others.filter((o) => rank.get(o) < rank.get(id)).length;
    portsOf.get(id)[g.side].push({ group: g, lane: g.lane, way: ups === others.length ? 0 : ups ? 1 : 2 });
  }
  for (const e of outside) portsOf.get(e.id)?.[e.side].push({ key: e.key, lane: Infinity, way: e.up ? 0 : 2 });
  const inOrder = (p, q) => p.way - q.way || (p.way ? q.lane - p.lane : p.lane - q.lane);
  for (const sides of portsOf.values()) for (const side of SIDES) sides[side].sort(inOrder);
  // A step grows to hold its ports a wire apart.
  for (const id of order) {
    const n = nodes.get(id), most = Math.max(...SIDES.map((s) => portsOf.get(id)[s].length));
    // From its own size each time, so a strip laid out again does not grow it twice.
    n.base ??= n.h;
    n.h = Math.max(n.base, (most + 1) * WIRE);
  }
  // The rows, and the two gutters either side of the steps' left edge.
  const y = new Map(), x = new Map();
  let at = 0;
  for (const id of order) (y.set(id, at + nodes.get(id).h / 2), (at += nodes.get(id).h + GAP));
  const count = (side) => Math.max(0, ...groups.filter((g) => g.side === side).map((g) => g.lane + 1));
  const left = count('left') ? ROOM + (count('left') - 1) * WIRE : 0, wide = Math.max(0, ...order.map((id) => nodes.get(id).w));
  for (const id of order) x.set(id, left + nodes.get(id).w / 2);
  const laneX = (side, lane) => (side === 'left' ? left - ROOM - lane * WIRE : left + wide + ROOM + lane * WIRE);
  stage('rows', { x, y });
  // Each end's port: on its step's side, its ports spread down it.
  const portAt = (id, side, find) => {
    const list = portsOf.get(id)[side], k = list.findIndex(find), n = nodes.get(id);
    return [side === 'left' ? left : left + n.w, y.get(id) - n.h / 2 + (n.h * (k + 1)) / (list.length + 1)];
  };
  const placed = [];
  for (const g of groups) {
    const X = laneX(g.side, g.lane);
    const drawn = g.wires.map((w) => {
      const [pa, pb] = [w.a, w.b].map((id) => portAt(id, g.side, (p) => p.group === g));
      return { ...w, points: [pa, [X, pa[1]], [X, pb[1]], pb] };
    });
    placed.push(...(g.hub ? bundle(drawn) : drawn));
  }
  const ports = new Map(outside.filter((e) => portsOf.has(e.id)).map((e) => [e.key, portAt(e.id, e.side, (p) => p.key === e.key)]));
  const clean = (w) => { const { kind, side, hub, ...rest } = w; return rest; };
  const out = { x, y, chains: placed.filter((w) => w.kind === 'chain').map(clean), ties: placed.filter((w) => w.kind === 'tie').map(clean), ports };
  stage('wires', { chains: out.chains.map((w) => w.points), ties: out.ties.map((w) => w.points) });
  const r = Math.max(left + wide, count('right') ? laneX('right', count('right') - 1) : 0);
  return { ...out, extent: { l: 0, t: 0, r, b: Math.max(0, at - GAP) } };
}
