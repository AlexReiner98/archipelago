// A graph drawn from its planar embedding as a visibility representation (Tamassia and Tollis): each item a bar across a
// run of columns, each wire straight down a column from one bar to another, so the planar part cannot cross and every
// wire is at right angles. An st-numbering sets the rows, the faces between the wires set the columns, and the longest
// path through each keeps both as tight as they can be. Trees hang in combs beside their item. Each layer is its own
// module, read in the order this one calls them: graph (./steps.js, ./direction.js, ./hangs.js), topology (./topology.js),
// shape and metrics (./part.js, ./search.js), shape (./shape.js), then metrics alone (./assemble.js, ./solve.js, ./finish.js). Pure: an answer
// in, geometry out, as the flow's layout answers.

import { assemble, shelfOf } from './assemble.js';
import { count } from './count.js';
import { directions } from './direction.js';
import { finisher } from './finish.js';
import { flatten, isOf, ORDER } from './graph.js';
import { hangsOf, partsOf } from './hangs.js';
import { pair } from './polyline.js';
import { drawnPart, linksOf } from './search.js';
import { shape } from './shape.js';
import { solve, solveSections } from './solve.js';
import { apart, portItems, setPorts } from './ports.js';
import { stepsOf } from './steps.js';

/** How many finished pictures are kept. */
const KEPT = 8;

/** For a bench: told each stage's lines as it ends, by link. */
let staging = null;
export const stages = (fn) => (staging = fn);

/** Pictures already pulled tight, the newest last: going back to a lens, or dropping a step, costs next to nothing. */
const kept = new Map();

/** The layout of an answer, worked out once for each answer and kept. */
export function layout(args) {
  const { items, links, undrawn, headless, sizes, aspect, shapes, ports, extras } = args, key = JSON.stringify([items, links, undrawn, headless, sizes, aspect, shapes, ports, extras]);
  const hit = kept.get(key) ?? laidOut(args);
  kept.delete(key);
  kept.set(key, hit);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value);
  // What the finished picture was drawn from, for a level above to set it again round its ports (./ports.js).
  return Object.assign(hit(), { raw: hit.raw });
}

/** Each line's way chosen, the boxes at `x` and `y`. */
function shapeWires({ nodes, x, y, lines, z, through, inward }) {
  const boxes = new Map([...x.keys()].map((id) => [id, { x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h, pointed: nodes.get(id).shape === 'diamond' }]));
  shape(boxes, lines, { room: z.room, run: z.run, corner: z.corner, wire: z.turn, ports: z.ports, rounds: z.rounds, cost_cross: z.shape_cross, cost_bend: z.cost_bend, cost_side: z.cost_side, work: z.shape_work, through, inward });
}

/** The routes as lines, each from its `from`. */
const linesOf = (routes) => [...routes].map(([k, r]) => { const [p, q] = k.split('|'); return { r, a: r.from, b: r.from === p ? q : p, points: r.points }; });

/** Gives each link its own route (`route`): the first between two boxes their pair, each after it a key of its own. Answers with those, each to the first. */
function routesOf(every) {
  const seen = new Map(), twins = new Map();
  for (const w of every) {
    const of = pair(w.a, w.b), n = seen.get(of) ?? 0;
    seen.set(of, n + 1);
    w.route = n ? `${of}|${n}` : of;
    if (n) twins.set(w.route, of);
  }
  return twins;
}

/** Every length and limit the layout works by, from the style. */
function lengthsOf(sizes) {
  const gap = sizes.flow_node_gap;
  return {
    row: sizes.flow_layer_gap / 2, col: sizes.flow_wire_column, turn: Math.max(gap / 3, sizes.flow_wire_gap), gap,
    room: sizes.flow_wire_room, join: sizes.flow_joined_room, run: sizes.flow_port_run, corner: sizes.flow_port_corner,
    trials: sizes.flow_trials, trial_most: sizes.flow_trial_most, cost_up: sizes.flow_cost_up, cost_cross: sizes.flow_cost_crossing, shape_cross: sizes.flow_shape_crossing, shape_most: sizes.flow_shape_most, shape_work: sizes.flow_shape_work, cost_bend: sizes.flow_cost_bend, cost_side: sizes.flow_cost_side, ports: sizes.flow_reroute_ports, rounds: sizes.flow_reroute_rounds, cost_wrong: sizes.flow_cost_wrong_side, embed_most: sizes.flow_embed_most, embed_big: sizes.flow_embed_big, hub_most: sizes.flow_hub_most, embed_cost: sizes.flow_embed_crossings, slide_sweeps: sizes.flow_slide_sweeps, number_tries: sizes.flow_number_tries, trial_total: sizes.flow_trial_total,
  };
}

/** How many times a finished picture's wires cross. */
const crossed = ({ chains, ties }) => count([...chains, ...ties].map((w) => w.points)).crossings;

/** Every picture is drawn the same two ways, its headed links as wires and as comb leaves, and the finished picture that crosses less kept, as wires where they tie. */
function laidOut(args) {
  // Past what the style gives the search, a picture is drawn the one way, which takes the less room.
  if (args.items.length > args.sizes.flow_trial_total) return drawnOut({ ...args, chains: false });
  const [wired, combed] = [true, false].map((chains) => drawnOut({ ...args, chains }));
  return crossed(wired({})) <= crossed(combed({})) ? wired : combed;
}

function drawnOut({ items: asked, links: linked = [], undrawn = [], headless = ['part_of'], measure, sizes, shapes, aspect = 1.6, chains: asWires, ports = [], extras = [] }) {
  // An island laid out again with its ports (./ports.js): each port, and its name and legend, a box of its own.
  const ported = ports.length > 0, pad = sizes.flow_island_pad, { items: given, links: told } = ported ? portItems(asked, linked, ports, extras) : { items: asked, links: linked };
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes, shapes });
  const z = lengthsOf(sizes), { gap } = z, margin = sizes.flow_margin, stepSize = (id) => nodes.get(id);
  // A link from an item to an actor (waits on, owned by) is drawn from the actor to the item, as the order is drawn from
  // what is depended on: the person first, the head on what they act on (the owner, 4 Nov 2026). `flipped` says so.
  const actor = new Set(items.filter((i) => isOf(i, 'actor')).map((i) => i.id));
  const toActor = (l) => actor.has(l.to) && !actor.has(l.from);
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ ...(toActor(l) ? { a: l.to, b: l.from, flipped: true } : { a: l.from, b: l.to }), type: l.type, ...(l.pending && { pending: l.pending }) }));
  const chains = edges.map((e) => ({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b) }));
  const every = [...chains, ...ties], twins = routesOf(every);
  const a = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of every) if (w.a !== w.b && a.has(w.a) && a.has(w.b)) (a.get(w.a).add(w.b), a.get(w.b).add(w.a));
  const ways = directions(chains, ties, headless), hangs = hangsOf({ a, ways, nodes, sizes, gap, z, aspect, chains: asWires }), { core, block } = hangs;
  const how = { block, stepSize, ways, z, total: core.length };
  const shelves = partsOf(core, a).map((list) => shelfOf(drawnPart(list, linksOf(list, every, ways), how), block));
  const { x, y, routes } = assemble(shelves, { ...hangs, stepSize, gap, margin, aspect });
  // Two links between one pair of boxes are drawn from one sketch, and each is then a wire like any other.
  for (const [k, of] of twins) if (routes.has(of)) routes.set(k, { ...routes.get(of), points: routes.get(of).points.map((p) => [...p]) });
  staging?.('bars and combs', routes);
  const inward = ported ? setPorts({ nodes, x, y, routes, ports, extras, gap: sizes.flow_island_legend_gap, pad }) : undefined;
  const lengths = { nodes, x, y, routes, section: sizes.flow_section_gap, gap, margin, aspect, wire: z.turn, room: z.room, run: z.run, corner: z.corner, apart: gap / 2, join: z.join }, firstWires = new Map([...routes].map(([k, r]) => [k, r.points]));
  const before = { x: new Map(x), y: new Map(y), sizes: new Map([...nodes].map(([id, n]) => [id, [n.w, n.h]])) };
  if (routes.size <= z.shape_most) {
    const lines = linesOf(routes);
    shapeWires({ nodes, x, y, lines, z, inward });
    for (const l of lines) l.r.points = l.points;
  }
  staging?.('shape', routes);
  // With ports, the island is one section: its frame is round all of it.
  const solved = (all) => (ported ? solve({ ...all, edging: pad }) : solveSections(all));
  try {
    solved(lengths);
  } catch (e) {
    // A sketch the solve cannot order is drawn from the first wires, which it always can.
    console.warn?.(`The shape fell back: ${e.message}`);
    for (const [id, at] of before.x) (x.set(id, at), y.set(id, before.y.get(id)), Object.assign(nodes.get(id), { w: before.sizes.get(id)[0], h: before.sizes.get(id)[1] }));
    for (const [k, r] of routes) r.points = firstWires.get(k);
    solved(lengths);
  }
  staging?.('solve', routes);
  const done = finisher({ nodes, potential, chains, ties, x, y, routes, margin, stepSize }), out = ported ? () => apart(done(), { ports, extras, pad }) : done;
  return Object.assign(out, { raw: { nodes, potential, chains, ties, x, y, routes, margin, stepSize, z } });
}
