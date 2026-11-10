// Step 3 of the one layout (task e_7et8f4uv, hub e_9uhaqhwe): every place of the shape step 2 gives set in one solve.
// The shape (its format on task e_7vp7udzk) fixes each stretch's way and the order of what stands beside what; this
// sets the distances: what must stand together (./atoms.js), what must stay apart and in which order (./order.js), and
// the relaxation itself (./solve.js), each round told as a stage so it can be watched. Every distance is a size on the
// style. Layer: metrics. Pure: the shape in, the places out.

import { atoms, isBox } from './atoms.js';
import { orderOn } from './order.js';
import { relaxed } from './solve.js';
import { stage } from './stage.js';

/** Every size the relaxation reads, by the name the style gives it. */
const NAMES = ['relax_unit', 'relax_pull', 'relax_even', 'relax_hold', 'relax_center', 'relax_rigid', 'relax_step', 'relax_rounds', 'relax_sweeps', 'relax_still', 'relax_every', 'relax_near', 'relax_unstack'];

/** The distances and weights, from the style; `heads` gives an island's name and legend height over what it holds. */
export function lengthsOf(sizes, heads = new Map()) {
  for (const name of NAMES) if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one the relaxation uses`);
  const z = (k) => sizes[`relax_${k}`];
  return {
    apart: sizes.flow_node_gap, wire: Math.max(sizes.flow_node_gap / 3, sizes.flow_wire_gap), room: sizes.flow_wire_room, run: sizes.flow_port_run, corner: sizes.flow_port_corner,
    pad: sizes.flow_island_pad, sea: sizes.flow_island_sea, shore: sizes.flow_island_sea / 2, head: (id) => heads.get(id) ?? sizes.flow_island_name_room,
    unit: z('unit'), pull: z('pull'), even: z('even'), hold: z('hold'), center: z('center'), rigid: z('rigid'), step: z('step'), exact: sizes.relax_exact ?? 0, simplex: sizes.shape_flow_simplex ?? 0, rounds: z('rounds'), sweeps: z('sweeps'), still: z('still'), every: z('every'), near: z('near'), unstack: z('unstack'),
  };
}

/** Where a key starts on axis `a`: the shape's grid place a `unit` apart, a box's sides its drawn size about its middle. */
function startOf(read, wires, key, a, unit) {
  const kind = key[0], last = key.lastIndexOf(':'), c = ['x', 'y'][a], id = key.slice(2, last), k = Number(key.slice(last + 1));
  if (kind === 'n') return unit * read.nodes.get(key.slice(2))[c];
  if (kind === 'b') return unit * read.nodes.get(id)[c] + ((k ? 1 : -1) * read.nodes.get(id).size[a]) / 2;
  if (kind === 'w') return unit * wires.get(id).points[k][a];
  return unit * read.islands.get(id).rect[a + 2 * k];
}

/** The numbers of one axis: each root its index, where it starts, the stretches along it and the distances. */
function axisOf(read, a, z) {
  const ax = read.axes[a], index = new Map(), wires = new Map(read.wires.map((w) => [w.id, w]));
  for (const key of ax.keys()) { const [r] = ax.find(key); if (!index.has(r)) index.set(r, index.size); }
  const start = new Array(index.size);
  for (const [r, k] of index) start[k] = startOf(read, wires, r, a, z.unit);
  const { order, bounds, caps } = orderOn(read, a, z), at = (arcs) => arcs.map(([p, q, l]) => [index.get(p), index.get(q), l]);
  const stretches = [];
  for (const w of read.wires) w.points.forEach((q, k) => {
    if (!k || w.points[k - 1][a] === q[a]) return;
    const [rp, op] = ax.find(`w:${w.id}:${k - 1}`), [rq, oq] = ax.find(`w:${w.id}:${k}`);
    if (rp !== rq) stretches.push([index.get(rp), index.get(rq), op - oq]);
  });
  /** A pull [p, q, by]: the key `to` toward `by` past the key `from`. */
  const pull = (from, to, by) => { const [rp, op] = ax.find(from), [rq, oq] = ax.find(to); return rp === rq ? [] : [[index.get(rp), index.get(rq), by + op - oq]]; };
  // A wire's end is drawn toward the middle of its box's side, so what a straight wire joins stands in line; and a box
  // toward its own size, growing only where what passes it needs the room.
  const centred = ax.ranges.flatMap((r) => [...pull(r.lo, r.end, r.size / 2), ...pull(r.end, r.hi, r.size / 2)]);
  const rigid = [...read.nodes.values()].filter(isBox).flatMap((n) => pull(`b:${n.id}:0`, `b:${n.id}:1`, n.size[a]));
  const value = (key, v) => { const [r, o] = ax.find(key); return v[index.get(r)] + o; };
  /** One more least distance, `to` at least `length` past `from`, by key; nothing when the two are one number. */
  const keep = (from, to, length) => { const [rp, op] = ax.find(from), [rq, oq] = ax.find(to); if (rp !== rq) order.push([rp, rq, op + length - oq]); };
  return { n: index.size, start, stretches, centred, rigid, order: at(order), bounds: at(bounds), caps: at(caps), value, keep: (from, to, length) => { keep(from, to, length); return at([order.at(-1)])[0]; } };
}

/** The places of every node, wire, island and port, from the numbers `at` of both axes. */
function placesOf(read, axes, at) {
  const v = (key, a) => axes[a].value(key, at[a]);
  return {
    nodes: [...read.nodes.values()].map((n) => {
      if (!isBox(n)) return { id: n.id, kind: n.kind, x: v(`n:${n.id}`, 0), y: v(`n:${n.id}`, 1), w: 0, h: 0 };
      const [l, t, r, b] = [v(`b:${n.id}:0`, 0), v(`b:${n.id}:0`, 1), v(`b:${n.id}:1`, 0), v(`b:${n.id}:1`, 1)];
      return { id: n.id, kind: n.kind, x: (l + r) / 2, y: (t + b) / 2, w: r - l, h: b - t };
    }),
    wires: read.wires.map((w) => ({ id: w.id, link: w.link, type: w.type, reversed: w.reversed, points: w.points.map((_, k) => [v(`w:${w.id}:${k}`, 0), v(`w:${w.id}:${k}`, 1)]) })),
    islands: [...read.islands.values()].map((i) => ({ id: i.id, rect: [v(`i:${i.id}:0`, 0), v(`i:${i.id}:0`, 1), v(`i:${i.id}:1`, 0), v(`i:${i.id}:1`, 1)] })),
    ports: read.ports.map((p) => ({ id: p.id, island: p.island, side: p.side, x: v(`n:${p.id}`, 0), y: v(`n:${p.id}`, 1) })),
  };
}

/** Each pair of boxes that stands on another at `at`, as [p, q] of the shape's nodes. */
function overlaps(read, axes, at) {
  const boxes = [...read.nodes.values()].filter(isBox).map((n) => ({ id: n.id, side: [0, 1].map((a) => [axes[a].value(`b:${n.id}:0`, at[a]), axes[a].value(`b:${n.id}:1`, at[a])]) }));
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [p, q] = [boxes[i], boxes[j]];
    if ([0, 1].every((a) => Math.min(p.side[a][1], q.side[a][1]) - Math.max(p.side[a][0], q.side[a][0]) > TOUCH_OVER)) out.push([p, q]);
  }
  return out;
}
/** Less than this much shared is two boxes touching, not one on another. */
const TOUCH_OVER = 0.5;

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
 * how short the last left a distance, how many could not be kept, how many contradicted others and were let go, and ends the shape put on no side of their box).
 */
export function relax(shape, { size, sizes, heads, afford = () => true }) {
  const z = lengthsOf(sizes, heads), read = atoms(shape, { size, corner: z.corner, wire: z.wire });
  const axes = [0, 1].map((a) => axisOf(read, a, z));
  let { at, told } = relaxed(axes, z, (r, now, phase) => stage('relax', { round: r, phase, ...atOrigin(placesOf(read, axes, now)) }));
  // Two boxes that never saw one another in the shape (diagonal there) can grow into each other: each pair that stands
  // on another is kept apart on the axis the shape put them furthest apart on, in the shape's order, and solved again.
  for (let round = 0; round < z.unstack; round++) {
    const met = overlaps(read, axes, at);
    // Each solve again asks the picture's budget for as much as the first one's rounds.
    if (!met.length || !afford(axes[0].n * z.rounds)) break;
    for (const [p, q] of met) {
      const d = [0, 1].map((a) => read.nodes.get(q.id)[['x', 'y'][a]] - read.nodes.get(p.id)[['x', 'y'][a]]), a = Math.abs(d[0]) >= Math.abs(d[1]) ? 0 : 1;
      const [lo, hi] = d[a] >= 0 ? [p, q] : [q, p];
      axes[a].order.push(axes[a].keep(`b:${lo.id}:1`, `b:${hi.id}:0`, z.apart));
    }
    ({ at, told } = relaxed(axes, z, (r, now, phase) => stage('relax', { round: r, phase, ...atOrigin(placesOf(read, axes, now)) })));
  }
  return { ...atOrigin(placesOf(read, axes, at)), told: { ...told, refused: read.axes[0].refused + read.axes[1].refused } };
}
