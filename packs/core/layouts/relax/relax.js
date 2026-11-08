// Step 3 of the one layout (task e_7et8f4uv, hub e_9uhaqhwe): every place of the shape step 2 gives set in one solve.
// The shape (its format on task e_7vp7udzk) fixes each stretch's way and the order of what stands beside what; this
// sets the distances: what must stand together (./atoms.js), what must stay apart and in which order (./order.js), and
// the relaxation itself (./solve.js), each round told as a stage so it can be watched. Every distance is a size on the
// style. Layer: metrics. Pure: the shape in, the places out.

import { atoms } from './atoms.js';
import { orderOn } from './order.js';
import { relaxed } from './solve.js';
import { stage } from './stage.js';

/** Every size the relaxation reads, by the name the style gives it. */
const NAMES = ['relax_unit', 'relax_pull', 'relax_even', 'relax_hold', 'relax_center', 'relax_step', 'relax_rounds', 'relax_sweeps', 'relax_still', 'relax_every', 'relax_near'];

/** The distances and weights, from the style; `heads` gives an island's name and legend height over what it holds. */
export function lengthsOf(sizes, heads = new Map()) {
  for (const name of NAMES) if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one the relaxation uses`);
  const z = (k) => sizes[`relax_${k}`];
  return {
    apart: sizes.flow_node_gap, wire: Math.max(sizes.flow_node_gap / 3, sizes.flow_wire_gap), room: sizes.flow_wire_room, run: sizes.flow_port_run, corner: sizes.flow_port_corner,
    pad: sizes.flow_island_pad, sea: sizes.flow_island_sea, shore: sizes.flow_island_sea / 2, head: (id) => heads.get(id) ?? sizes.flow_island_name_room,
    unit: z('unit'), pull: z('pull'), even: z('even'), hold: z('hold'), center: z('center'), step: z('step'), rounds: z('rounds'), sweeps: z('sweeps'), still: z('still'), every: z('every'), near: z('near'),
  };
}

/** Where the shape puts a key on axis `a`, in grid units. */
function gridOf(read, key, a) {
  const [kind, id, k] = key.split(':'), c = ['x', 'y'][a];
  if (kind === 'n') return read.nodes.get(id)[c];
  if (kind === 'i') return read.islands.get(id).rect[a + 2 * Number(k)];
  return read.wires.find((w) => w.id === id).points[Number(k)][a];
}

/** The numbers of one axis: each root its index, where it starts, the stretches along it and the distances. */
function axisOf(read, a, z) {
  const ax = read.axes[a], index = new Map(), wires = new Map(read.wires.map((w) => [w.id, w]));
  for (const key of ax.keys()) { const [r] = ax.find(key); if (!index.has(r)) index.set(r, index.size); }
  const grid = (key) => (key.startsWith('w:') ? wires.get(key.split(':')[1]).points[Number(key.split(':')[2])][a] : gridOf(read, key, a));
  const start = new Array(index.size);
  for (const [r, k] of index) start[k] = z.unit * grid(r);
  const { order, bounds } = orderOn(read, a, z), at = (arcs) => arcs.map(([p, q, l]) => [index.get(p), index.get(q), l]);
  const stretches = [];
  for (const w of read.wires) w.points.forEach((q, k) => {
    if (!k || w.points[k - 1][a] === q[a]) return;
    const [rp, op] = ax.find(`w:${w.id}:${k - 1}`), [rq, oq] = ax.find(`w:${w.id}:${k}`);
    if (rp !== rq) stretches.push([index.get(rp), index.get(rq), op - oq]);
  });
  // A wire's end is drawn toward the middle of its box's side, so what a straight wire joins stands in line.
  const centred = [];
  for (const r of ax.ranges) {
    const [rb, ob] = ax.find(r.box), [re, oe] = ax.find(r.end);
    if (rb !== re) centred.push([index.get(rb), index.get(re), ob - oe]);
  }
  const value = (key, v) => { const [r, o] = ax.find(key); return v[index.get(r)] + o; };
  return { n: index.size, start, stretches, centred, order: at(order), bounds: at(bounds), value };
}

/** The places of every node, wire, island and port, from the numbers `at` of both axes. */
function placesOf(read, axes, at) {
  const v = (key, a) => axes[a].value(key, at[a]);
  return {
    nodes: [...read.nodes.values()].map((n) => ({ id: n.id, kind: n.kind, x: v(`n:${n.id}`, 0), y: v(`n:${n.id}`, 1), w: n.size[0], h: n.size[1] })),
    wires: read.wires.map((w) => ({ id: w.id, link: w.link, type: w.type, reversed: w.reversed, points: w.points.map((_, k) => [v(`w:${w.id}:${k}`, 0), v(`w:${w.id}:${k}`, 1)]) })),
    islands: [...read.islands.values()].map((i) => ({ id: i.id, rect: [v(`i:${i.id}:0`, 0), v(`i:${i.id}:0`, 1), v(`i:${i.id}:1`, 0), v(`i:${i.id}:1`, 1)] })),
    ports: read.ports.map((p) => ({ id: p.id, island: p.island, side: p.side, x: v(`n:${p.id}`, 0), y: v(`n:${p.id}`, 1) })),
  };
}

/** Everything moved so the least of it stands at 0, 0. */
function atOrigin(p) {
  const xs = [...p.nodes.flatMap((n) => [n.x - n.w / 2]), ...p.wires.flatMap((w) => w.points.map((q) => q[0])), ...p.islands.map((i) => i.rect[0])];
  const ys = [...p.nodes.flatMap((n) => [n.y - n.h / 2]), ...p.wires.flatMap((w) => w.points.map((q) => q[1])), ...p.islands.map((i) => i.rect[1])];
  const [dx, dy] = [Math.min(...xs), Math.min(...ys)];
  return {
    nodes: p.nodes.map((n) => ({ ...n, x: n.x - dx, y: n.y - dy })), wires: p.wires.map((w) => ({ ...w, points: w.points.map(([x, y]) => [x - dx, y - dy]) })),
    islands: p.islands.map((i) => ({ ...i, rect: [i.rect[0] - dx, i.rect[1] - dy, i.rect[2] - dx, i.rect[3] - dy] })), ports: p.ports.map((q) => ({ ...q, x: q.x - dx, y: q.y - dy })),
  };
}

/**
 * The shape relaxed: `shape` as step 2 gives it, `size(node)` each node's drawn [w, h], `sizes` the style's, `heads` each
 * island's head height. Answers `nodes`, `wires`, `islands` and `ports` placed (from 0, 0), and `told` (how many rounds,
 * how short the last left a distance, how many could not be kept, and ends the shape put on no side of their box).
 */
export function relax(shape, { size, sizes, heads }) {
  const z = lengthsOf(sizes, heads), read = atoms(shape, { size, corner: z.corner });
  const axes = [0, 1].map((a) => axisOf(read, a, z));
  const { at, told } = relaxed(axes, z, (r, now, phase) => stage('relax', { round: r, phase, ...atOrigin(placesOf(read, axes, now)) }));
  return { ...atOrigin(placesOf(read, axes, at)), told: { ...told, refused: read.axes[0].refused + read.axes[1].refused } };
}
