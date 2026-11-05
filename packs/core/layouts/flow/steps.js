// The steps of a picture: each item a box of its size, as the flow sizes them, the order's wires between them, and a choice
// nothing follows yet as a step of its own. Pure: an answer in, steps and wires out.

import { acyclic, lineageOf, ORDER, QUIET, reduced } from './graph.js';
import { lines } from './lines.js';

const need = (set, name) => {
  if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the plane lays out by`);
  return set[name];
};

/** The outlines a step may have: in the house style, one for each of core's starter types (decision e_u8aytubm). */
export const SHAPES = ['box', 'diamond', 'pill', 'sheet', 'cut', 'hexagon', 'flag', 'tab'];
/** The type in an item's lineage nearest it that the style gives an outline (`shapes.type`), if any. */
export const shapedBy = (i, shapes = {}) => lineageOf(i).find((t) => SHAPES.includes(shapes.type?.[t]));
/** How far each outline cuts into its box, by the size the style names for it: none for a box, diamond, pill or sheet. */
const BEVEL = { cut: 'flow_cut', hexagon: 'flow_point', flag: 'flow_point', tab: 'flow_tab' };

/**
 * Each item a step with its size, as the flow sizes them; a choice nothing follows yet is a step of its own. Its outline
 * is the one the style gives its type (`shapes.type`), else the nearest type it is a flavour of that has one, else a box.
 */
export function stepsOf({ items, links, measure, sizes, shapes = {} }) {
  const [MAX_TEXT, TEXT, STUB_TEXT, DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_max_text', 'flow_text', 'flow_stub_text', 'flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const shapeOf = (i) => shapes.type?.[shapedBy(i, shapes)] ?? 'box';
  const nodes = new Map();
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
    const px = n.stub ? STUB_TEXT : TEXT;
    n.lines = n.shape === 'end' ? [n.item.title] : lines(n.item.title, MAX_TEXT, (t) => measure(t, px));
    n.line = LINE;
    const text = Math.min(n.lines.reduce((s, t) => Math.max(s, measure(t, px)), 0), MAX_TEXT), more = (n.lines.length - 1) * LINE;
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H + more];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else [n.w, n.h] = [text + BOX_PAD, (n.shape === 'sheet' ? SHEET_H : BOX_H) + more];
    // A pointed end takes room beside the name: one for a flag, both for a hexagon.
    if (BEVEL[n.shape]) n.bevel = need(sizes, BEVEL[n.shape]);
    if (n.shape === 'hexagon' || n.shape === 'flag') n.w += n.bevel * (n.shape === 'hexagon' ? 2 : 1);
  }
  return { nodes, edges, potential };
}
