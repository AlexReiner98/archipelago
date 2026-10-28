// A flow's layout, apart from its drawing (the core pack's flow drawing, index.js): a flat graph on one plane, where
// depth is never drawn (e_ktdensts). Every item is a step. depends_on is the order: a step leads to another when the
// other depends on it, read from the top down. Every other link (part_of first) is a quiet tie that pulls its two
// ends near; nothing is grouped, boxed or nested. What is tied together is one cluster, laid out by Sugiyama's method
// with every link a line through its rows (./layers.js) and every line wired by one rule (./wires.js): the order's and
// the ties alike, at right angles, each on a track of its own or on its bus. A step put by hand (`placed`) stays
// exactly where it was put; the clusters are set round it, and the lines to it are solved round the steps (./free.js).
// What follows an open question is a scenario, and a choice nothing follows yet ends in a step of its own. Pure: an
// answer in, geometry out; `measure(text, px)` gives a title's width at a size.

import { route, routeTies } from './free.js';
import { lines } from './lines.js';
import { acyclic, flatten, grouped, highest, ORDER, QUIET, reduced } from './graph.js';
import { lay as layCluster } from './layers.js';

export { LARGE } from './layers.js';
/** The shape a picture is wrapped toward when none is asked for, as wide as tall times this: about a page's. */
export const ASPECT = 1.6;

/**
 * The steps (each with its place x, y and size w, h), the wires of the order (`chains`, each with its points), the
 * ties (each with its two points), the breaks and the whole size. Every length and count it lays out by is the
 * style's (`sizes` and `numbers`, flow_*): the house style in packs/core/pack.json names each, and a nearer style may
 * change any. `placed` is where steps were put by hand, their middles by item. `aspect` is the shape to wrap toward,
 * as wide as tall times it: the drawing gives the pane's, so a narrow pane is filled down and a wide one across.
 */
export function layout({ items: given, links: told = [], undrawn = [], placed = {}, measure, sizes, aspect = ASPECT }) {
  const need = (set, name) => {
    if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the flow lays out by`);
    return set[name];
  };
  const [LAYER_GAP, NODE_GAP, MARGIN, MAX_TEXT, TRACK, SLOT, LEAD_OUT, LEAD_IN] = ['flow_layer_gap', 'flow_node_gap', 'flow_margin', 'flow_max_text', 'flow_track', 'flow_slot', 'flow_lead_out', 'flow_lead_in'].map((n) => need(sizes, n));
  const [TEXT, STUB_TEXT] = ['flow_text', 'flow_stub_text'].map((n) => need(sizes, n));
  const [DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  if (!nodes.size) return { nodes, all: [], chains: [], ties: [], breaks: [], potential: new Set(), x: new Map(), y: new Map(), width: 0, height: 0 };

  // ---- The order (a leads to b when b depends on a; a line that says something says which option it follows), and
  // the ties: every other link, from what is part of to what it is part of.
  const seen = new Set();
  let edges = [];
  for (const l of links) if (l.type === ORDER && !seen.has(`${l.to} ${l.from}`)) (seen.add(`${l.to} ${l.from}`), edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }), ...(l.pending && { pending: l.pending }) }));
  edges = reduced(acyclic(edges, [...nodes.keys()]));
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));

  // An open question's choices: each one no wire follows yet ends in a pill of its own.
  const decisions = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of decisions) {
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    (Array.isArray(d.item.choices) ? d.item.choices : []).forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: QUIET } });
      edges.push({ a: d.id, b: id, says: option });
    });
  }
  // What follows an open decision happens only if that option is chosen.
  const after = grouped(edges, (e) => e.a, (e) => e.b), potential = new Set();
  const markOn = (id) => (after.get(id) ?? []).forEach((v) => potential.has(v) || (potential.add(v), markOn(v)));
  decisions.forEach((d) => markOn(d.id));

  // ---- Sizes: a step is as wide as its name, in two lines where one is too few (./lines.js), and a line taller for
  // the second. A choice's end keeps to one line. The gap between lines is the style's (flow_line_height), or the
  // text's own size and a quarter where a style names none.
  const LINE = sizes.flow_line_height ?? TEXT * 1.25;
  for (const n of nodes.values()) {
    const px = n.stub ? STUB_TEXT : TEXT;
    n.lines = n.shape === 'end' ? [n.item.title] : lines(n.item.title, MAX_TEXT, (t) => measure(t, px));
    n.line = LINE;
    const text = Math.min(highest(n.lines.map((t) => measure(t, px))), MAX_TEXT);
    const more = (n.lines.length - 1) * LINE;
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H + more];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else [n.w, n.h] = [text + BOX_PAD, (n.shape === 'sheet' ? SHEET_H : BOX_H) + more];
  }

  // ---- Clusters: what the order and the ties join, apart from the steps put by hand.
  const fixed = new Set(Object.keys(placed).filter((id) => nodes.has(id) && Array.isArray(placed[id])));
  const root = new Map([...nodes.keys()].map((id) => [id, id]));
  const find = (id) => {
    while (root.get(id) !== id) (root.set(id, root.get(root.get(id))), (id = root.get(id)));
    return id;
  };
  for (const { a, b } of [...edges, ...ties]) if (!fixed.has(a) && !fixed.has(b)) root.set(find(b), find(a));
  const clusters = grouped([...nodes.keys()].filter((id) => !fixed.has(id)), find);
  const x = new Map(), y = new Map();
  const z = { LAYER_GAP, NODE_GAP, BOX_H, TRACK, SLOT, LEAD_OUT, LEAD_IN };
  const lay = (ids, edges, ties) => layCluster(ids, edges, ties, { nodes, x, y, potential, aspect, z });

  // ---- The plane: the steps put by hand where they were put, each cluster set by them when it is tied to them
  // (under what leads into it, over what it leads into, else beside), and the rest in rows under all of that, the
  // largest first. A cluster set by others slides down until it is clear of all of them.
  const GAP = LAYER_GAP / 2;
  const boxes = [];
  for (const id of fixed) {
    const n = nodes.get(id);
    x.set(id, Number(placed[id][0]));
    y.set(id, Number(placed[id][1]));
    boxes.push({ l: x.get(id) - n.w / 2, t: y.get(id) - n.h / 2, r: x.get(id) + n.w / 2, b: y.get(id) + n.h / 2 });
  }
  const owned = new Map([...clusters].flatMap(([key, ids]) => ids.map((id) => [id, key])));
  const byCluster = (list) => grouped(list.filter((e) => owned.has(e.a) && owned.get(e.a) === owned.get(e.b)), (e) => owned.get(e.a));
  const [edgesOf, tiesOf] = [byCluster(edges), byCluster(ties)];
  const laid = [...clusters].map(([key, ids]) => ({ key, ties: tiesOf.get(key) ?? [], ...lay(ids, edgesOf.get(key) ?? [], tiesOf.get(key) ?? []) }));
  const chains = laid.flatMap((c) => c.chains), breaks = [];
  const shift = (c, l, t) => {
    for (const id of c.ids) (x.set(id, x.get(id) + l), y.set(id, y.get(id) + t));
    for (const w of [...c.chains, ...c.ties]) w.points = w.points.map(([px, py]) => [px + l, py + t]);
    for (const [px, py] of c.breaks) breaks.push([px + l, py + t]);
  };
  const box = (id) => ({ x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h });
  const lone = laid.sort((p, q) => q.ids.length - p.ids.length).filter((c) => {
    const own = new Set(c.ids);
    const into = edges.filter((e) => fixed.has(e.a) && own.has(e.b)).map((e) => box(e.a)), onto = edges.filter((e) => own.has(e.a) && fixed.has(e.b)).map((e) => box(e.b));
    const beside = [...edges, ...ties].filter((e) => (fixed.has(e.a) && own.has(e.b)) || (own.has(e.a) && fixed.has(e.b))).map((e) => box(fixed.has(e.a) ? e.a : e.b));
    if (!beside.length) return true;
    const mid = (list) => list.reduce((s, b) => s + b.x, 0) / list.length;
    let [l, t] = [mid(beside) - c.width / 2, 0];
    if (into.length) t = Math.max(...into.map((b) => b.y + b.h / 2)) + LAYER_GAP;
    else if (onto.length) t = Math.min(...onto.map((b) => b.y - b.h / 2)) - LAYER_GAP - c.height;
    else [l, t] = [Math.max(...beside.map((b) => b.x + b.w / 2)) + GAP, beside.reduce((s, b) => s + b.y, 0) / beside.length - c.height / 2];
    [l, t] = [Math.max(MARGIN, l), Math.max(MARGIN, t)];
    for (let hit; (hit = boxes.find((b) => l < b.r + GAP && l + c.width + GAP > b.l && t < b.b + GAP && t + c.height + GAP > b.t)); ) t = hit.b + GAP;
    shift(c, l, t);
    boxes.push({ l, t, r: l + c.width, b: t + c.height });
    return false;
  });
  // The rest in rows, as wide as the widest of it or of what is placed, and about the shape asked for.
  const area = lone.reduce((s, c) => s + (c.width + GAP) * (c.height + GAP), 0);
  const most = highest([...lone.map((c) => c.width), ...boxes.map((b) => b.r - MARGIN), Math.sqrt(area * aspect)]);
  const shelf = { x: MARGIN, y: boxes.length ? highest(boxes.map((b) => b.b)) + LAYER_GAP : MARGIN, row: 0 };
  for (const c of lone) {
    if (shelf.x > MARGIN && shelf.x + c.width > MARGIN + most) Object.assign(shelf, { x: MARGIN, y: shelf.y + shelf.row + GAP, row: 0 });
    shift(c, shelf.x, shelf.y);
    Object.assign(shelf, { x: shelf.x + c.width + GAP, row: Math.max(shelf.row, c.height) });
  }

  // ---- Lines to and from the steps put by hand, solved round the others: the order's, then the ties, from the
  // higher of their two ends to the lower.
  const all = [...nodes.values()].filter((n) => x.has(n.id));
  const steps = all.filter((n) => !n.dummy);
  for (const e of edges)
    if (fixed.has(e.a) || fixed.has(e.b)) {
      const others = steps.filter((n) => n.id !== e.a && n.id !== e.b).map((n) => box(n.id));
      chains.push({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b), points: route(box(e.a), box(e.b), LEAD_OUT, others) });
    }
  routeTies(ties.filter((t) => fixed.has(t.a) || fixed.has(t.b)), steps.map((n) => ({ id: n.id, ...box(n.id) })), [...chains, ...ties.filter((t) => t.points)], { lead: LEAD_OUT, cell: LAYER_GAP, track: TRACK });
  const drawn = [...chains, ...ties].flatMap((c) => c.points);
  const reachX = [...steps.map((n) => x.get(n.id) + n.w / 2), ...drawn.map((p) => p[0])];
  const reachY = [...steps.map((n) => y.get(n.id) + n.h / 2), ...drawn.map((p) => p[1])];
  return { nodes, all, chains, ties, breaks, potential, x, y, width: highest(reachX) + MARGIN, height: highest(reachY) + MARGIN };
}
