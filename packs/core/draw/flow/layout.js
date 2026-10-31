// A graph drawn from its planar embedding as a visibility representation (Tamassia and Tollis): each item a bar across a
// run of columns, each wire straight down a column from one bar to another, so the planar part cannot cross and every
// wire is at right angles. An st-numbering sets the rows, the faces between the wires set the columns, and the longest
// path through each keeps both as tight as they can be. Trees hang in combs beside their item. Each layer is its own
// module, read in the order this one calls them: graph (./steps.js, ./direction.js, ./hangs.js), topology (./topology.js),
// shape and metrics (./part.js, ./search.js), shape (./shape.js), then metrics alone (./assemble.js, ./solve.js, ./finish.js). Pure: an answer
// in, geometry out, as the flow's layout answers.

import { assemble, rigidOf, shelfOf } from './assemble.js';
import { directions } from './direction.js';
import { finisher } from './finish.js';
import { flatten, ORDER } from './graph.js';
import { hangsOf, partsOf } from './hangs.js';
import { drawnPart, linksOf } from './search.js';
import { shape } from './shape.js';
import { solveSections } from './solve.js';
import { stepsOf } from './steps.js';

/** How many finished pictures are kept. */
const KEPT = 8;

let last = null;
/** What the last layout drew, for the count in the key. */
export const latest = () => last;

/** For a bench: told each stage's lines as it ends, by link. */
let staging = null;
export const stages = (fn) => (staging = fn);

/** Pictures already pulled tight, the newest last: going back to a lens, or dropping a step, costs next to nothing. */
const kept = new Map();

/** The layout of an answer: what it was drawn from worked out once, and what was put by hand set on top of that. */
export function layout(args) {
  const { items, links, undrawn, headless, sizes, aspect } = args, key = JSON.stringify([items, links, undrawn, headless, sizes, aspect]);
  const hit = kept.get(key) ?? laidOut(args);
  kept.delete(key);
  kept.set(key, hit);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value);
  const { laid, seen } = hit(args.placed ?? {});
  last = seen;
  return laid;
}

/** Each wire's way chosen, the boxes where the first drawing has them. */
function shapeWires({ nodes, x, y, routes, z }) {
  const boxes = new Map([...x.keys()].map((id) => [id, { x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h, pointed: nodes.get(id).shape === 'diamond' }]));
  const wires = [...routes].map(([k, r]) => { const [p, q] = k.split('|'); return { r, a: r.from, b: r.from === p ? q : p, points: r.points, kept: r.set }; });
  shape(boxes, wires, { room: z.room, run: z.run, corner: z.corner, wire: z.turn, ports: z.ports, rounds: z.rounds, cost_cross: z.shape_cross, cost_bend: z.cost_bend, cost_side: z.cost_side, work: z.shape_work });
  for (const w of wires) w.r.points = w.points;
}

/** Every length and limit the layout works by, from the style. */
function lengthsOf(sizes) {
  const gap = sizes.flow_node_gap;
  return {
    row: sizes.flow_layer_gap / 2, col: sizes.plane_wire_column, turn: Math.max(gap / 3, sizes.plane_wire_gap), gap,
    room: sizes.plane_wire_room, join: sizes.plane_joined_room, run: sizes.plane_port_run, corner: sizes.plane_port_corner,
    trials: sizes.plane_trials, trial_most: sizes.plane_trial_most, cost_up: sizes.plane_cost_up, cost_cross: sizes.plane_cost_crossing, shape_cross: sizes.plane_shape_crossing, shape_most: sizes.plane_shape_most, shape_work: sizes.plane_shape_work, cost_bend: sizes.plane_cost_bend, cost_side: sizes.plane_cost_side, ports: sizes.plane_reroute_ports, rounds: sizes.plane_reroute_rounds, cost_wrong: sizes.plane_cost_wrong_side, embed_most: sizes.plane_embed_most, embed_big: sizes.plane_embed_big, hub_most: sizes.plane_hub_most, embed_cost: sizes.plane_embed_crossings, slide_sweeps: sizes.plane_slide_sweeps, number_tries: sizes.plane_number_tries, trial_total: sizes.plane_trial_total,
    row_gap: sizes.plane_row_gap, row_space: sizes.plane_row_space,
  };
}

function laidOut({ items: given, links: told = [], undrawn = [], headless = ['part_of'], measure, sizes, aspect = 1.6 }) {
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes });
  const z = lengthsOf(sizes), { gap } = z, margin = sizes.flow_margin, stepSize = (id) => nodes.get(id);
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties];
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  const ways = directions(chains, ties, headless), hangs = hangsOf({ a, ways, nodes, sizes, gap, z, aspect }), { core, block } = hangs;
  const how = { block, stepSize, ways, z, even: nodes.size <= sizes.plane_rows_most, rowsLinks: sizes.plane_rows_links, total: core.length };
  let threaded = 0;
  const shelves = partsOf(core, a).map((list) => {
    const made = drawnPart(list, linksOf(list, every, ways), how);
    threaded += made.threaded;
    return shelfOf(made.drawn, block);
  });
  const { x, y, routes, holder } = assemble(shelves, { ...hangs, stepSize, gap, margin, aspect });
  const rigid = rigidOf({ combs: hangs.combs, x, y, stepSize, block });
  staging?.('bars and combs', routes);
  const lengths = { nodes, x, y, routes, section: sizes.plane_section_gap, gap, margin, aspect, wire: z.turn, room: z.room, run: z.run, corner: z.corner, apart: gap / 2, join: z.join }, firstWires = new Map([...routes].map(([k, r]) => [k, r.points]));
  const before = { x: new Map(x), y: new Map(y), sizes: new Map([...nodes].map(([id, n]) => [id, [n.w, n.h]])) };
  if (routes.size <= z.shape_most) shapeWires({ nodes, x, y, routes, z });
  staging?.('shape', routes);
  try {
    solveSections(lengths);
  } catch (e) {
    // A sketch the solve cannot order is drawn from the first wires, which it always can.
    console.warn?.(`The shape fell back: ${e.message}`);
    for (const [id, at] of before.x) (x.set(id, at), y.set(id, before.y.get(id)), Object.assign(nodes.get(id), { w: before.sizes.get(id)[0], h: before.sizes.get(id)[1] }));
    for (const [k, r] of routes) r.points = firstWires.get(k);
    solveSections(lengths);
  }
  staging?.('solve', routes);
  // What a step put by hand starts from: each box where the solve left it, with what hangs on it.
  for (const id of x.keys()) rigid.set(id, { at: [x.get(id), y.get(id)], size: [nodes.get(id).w, nodes.get(id).h], hangs: rigid.get(id)?.hangs ?? [], pointed: nodes.get(id).shape === 'diamond' });
  return finisher({ nodes, potential, chains, ties, x, y, routes, rigid, holder, headless, sizes, z, margin, stepSize, tally: { threaded } });
}
