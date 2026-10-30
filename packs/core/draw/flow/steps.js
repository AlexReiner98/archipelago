// The steps of a picture: each item a box of its size, as the flow sizes them, the order's wires between them, and a choice
// nothing follows yet as a step of its own. Pure: an answer in, steps and wires out.

import { acyclic, ORDER, QUIET } from './graph.js';
import { lines } from './lines.js';

const need = (set, name) => {
  if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the plane lays out by`);
  return set[name];
};

/** Each item a step with its size, as the flow sizes them; a choice nothing follows yet is a step of its own. */
export function stepsOf({ items, links, measure, sizes }) {
  const [MAX_TEXT, TEXT, STUB_TEXT, DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_max_text', 'flow_text', 'flow_stub_text', 'flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  const seen = new Set();
  let edges = [];
  for (const l of links) if (l.type === ORDER && !seen.has(`${l.to} ${l.from}`)) (seen.add(`${l.to} ${l.from}`), edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }), ...(l.pending && { pending: l.pending }) }));
  edges = acyclic(edges, [...nodes.keys()]);
  const open = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of open) {
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    (Array.isArray(d.item.choices) ? d.item.choices : []).forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: QUIET } });
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
  }
  return { nodes, edges, potential };
}
