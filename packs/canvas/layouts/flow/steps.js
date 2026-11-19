// The steps of a picture: each item a box of its size, as the flow sizes them, the order's wires between them, and a choice
// nothing follows yet as a step of its own. Pure: an answer in, steps and wires out.

import { acyclic, lineageOf, ORDER, QUIET, reduced } from './graph.js';
import { lines } from './lines.js';

const need = (set, name) => {
  if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the plane lays out by`);
  return set[name];
};

/** The outlines a step may have: in the house style, one for each of core's starter types (decision e_u8aytubm). */
export const SHAPES = ['box', 'diamond', 'pill', 'sheet', 'cut', 'hexagon', 'flag', 'tab', 'ticket', 'lozenge', 'ridge', 'carved', 'chamfer', 'fold', 'summit', 'hut', 'swallow', 'roundend', 'plank', 'roofed', 'forward', 'roundstart', 'tallarrow', 'pennant'];
/** The outlines by type an item is drawn by: the view's, under those its island's packs give (`shapes.islands`, by island id; decision e_gqmavsb7). */
export const shapesFor = (i, shapes = {}) => ({ ...shapes.type, ...(shapes.islands?.[i.island] ?? {}) });
/** The type in an item's lineage nearest it that the style gives an outline (`shapes.type`), if any. */
export const shapedBy = (i, shapes = {}) => ((own) => lineageOf(i).find((t) => SHAPES.includes(own[t])))(shapesFor(i, shapes));
/** The outline an item is drawn in: its type's, else the nearest flavour's that has one, else a box. */
export const shapeIn = (i, shapes = {}) => (SHAPES.includes(shapes.ids?.[i.id]) ? shapes.ids[i.id] : shapesFor(i, shapes)[shapedBy(i, shapes)] ?? 'box');
/** The outlines a carving style gives one height (hexagon and pill among them). */
const CARVED = ['carved', 'chamfer', 'fold', 'summit', 'hut', 'hexagon', 'flag', 'pill', 'tab'];
/** How far each outline cuts into its box, by the size the style names for it: none for a box, diamond, pill or sheet. */
/** The ends a fingerpost board may have. */
const BOARDS = ['flag', 'swallow', 'hexagon', 'roundend', 'plank', 'roofed', 'forward', 'roundstart', 'tallarrow', 'pennant'];
const BEVEL = { chamfer: 'flow_chamfer', fold: 'flow_fold', summit: 'flow_summit', hut: 'flow_hut', swallow: 'flow_end_depth', roundend: 'flow_end_depth', roofed: 'flow_roof', pennant: 'flow_pennant', forward: 'flow_end_depth', roundstart: 'flow_end_depth', tallarrow: 'flow_end_depth', cut: 'flow_cut', hexagon: 'flow_point', lozenge: 'flow_lozenge', flag: 'flow_point', tab: 'flow_tab', ticket: 'flow_notch' };

/**
 * Each item a step with its size, as the flow sizes them; a choice nothing follows yet is a step of its own. Its outline
 * is the one the style gives its type (`shapes.type`), else the nearest type it is a flavour of that has one, else a box.
 */
export function stepsOf({ items, links, measure, sizes, shapes = {} }) {
  const [MAX_TEXT, TEXT, STUB_TEXT, DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_max_text', 'flow_text', 'flow_stub_text', 'flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const shapeOf = (i) => shapeIn(i, shapes);
  const nodes = new Map();
  // The items come made first (./graph.js): a place the answer gives (a run's, ./session.js) goes before that.
  for (const i of [...items].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  const seen = new Set();
  let edges = [];
  for (const l of links) if (l.type === ORDER && !seen.has(`${l.to} ${l.from}`)) (seen.add(`${l.to} ${l.from}`), edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }), ...(l.pending && { pending: l.pending }) }));
  edges = reduced(acyclic(edges, [...nodes.keys()]));
  const open = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of open) {
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    (Array.isArray(d.item.choices) ? d.item.choices : []).forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: QUIET, ...(d.item.island && { island: d.item.island }) } });
      edges.push({ a: d.id, b: id, says: option });
    });
  }
  const after = new Map();
  for (const e of edges) (after.get(e.a) ?? after.set(e.a, []).get(e.a)).push(e.b);
  const potential = new Set();
  const markOn = (id) => (after.get(id) ?? []).forEach((v) => potential.has(v) || (potential.add(v), markOn(v)));
  open.forEach((d) => markOn(d.id));
  const LINE = sizes.flow_line_height ?? TEXT * 1.25;
  for (const n of nodes.values()) {
    // A box of a level above (an island on the sea) is as big as what is laid out inside it, and has no name of its own here.
    if (Array.isArray(n.item.size)) { [n.w, n.h] = n.item.size; n.lines = []; n.line = LINE; continue; }
    const px = n.stub ? STUB_TEXT : TEXT;
    n.lines = n.shape === 'end' ? [n.item.title] : lines(n.item.title, MAX_TEXT, (t) => measure(t, px));
    n.line = LINE;
    const text = Math.min(n.lines.reduce((s, t) => Math.max(s, measure(t, px)), 0), MAX_TEXT), more = (n.lines.length - 1) * LINE;
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H + more];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else if (n.shape === 'ridge') [n.w, n.h] = [text + BOX_PAD, need(sizes, 'flow_ridge_height') + more];
    else [n.w, n.h] = [text + BOX_PAD, (n.shape === 'sheet' ? SHEET_H : BOX_H) + more];
    // Where the style carves its boxes every type is the same height, whatever its outline; a summit rises above that.
    if (shapes.carve && CARVED.includes(n.shape)) n.h = shapes.carve(n.item, n.lines.length * LINE) + (n.shape === 'summit' ? 2 * need(sizes, BEVEL.summit) : 0);
    // A fingerpost board (pass 8): one height whatever its end, and room at its left for the waymark plate.
    if (shapes.board && BOARDS.includes(n.shape)) [n.h, n.w] = [shapes.board.h + more + (n.shape === 'tallarrow' ? need(sizes, 'flow_board_extra') : 0), n.w + shapes.board.room];
    // A board with a plate hung under it has the room for it (as much above, so the boards of a row stay level): the layout places the node, the board stands in its middle.
    if (shapes.board?.plate) (n.plate = shapes.board.plate(n.item)), (n.h += 2 * n.plate);
    // A pointed end takes room beside the name: one for a flag, both for a hexagon.
    if (BEVEL[n.shape]) n.bevel = need(sizes, BEVEL[n.shape]);
    if (n.shape === 'summit') n.span = need(sizes, 'flow_summit_span');
    if (n.shape === 'hexagon' || n.shape === 'lozenge' || n.shape === 'flag' || n.shape === 'ticket' || n.shape === 'swallow' || n.shape === 'roundend' || n.shape === 'forward' || n.shape === 'roundstart' || n.shape === 'tallarrow' || n.shape === 'pennant') n.w += n.bevel * (n.shape === 'hexagon' || n.shape === 'lozenge' || n.shape === 'ticket' || n.shape === 'forward' ? 2 : 1);
    // A focus the style draws bigger (./focus.js): its box, not its words.
    if (!n.stub && shapes.scales?.[n.id] > 0) (n.w *= shapes.scales[n.id]), (n.h *= shapes.scales[n.id]);
  }
  // Each step's place in the order it was made, a choice not followed after every item: what a free choice goes by.
  let made = 0;
  for (const n of nodes.values()) n.made = made++;
  return { nodes, edges, potential };
}
