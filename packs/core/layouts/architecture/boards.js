// Work laid out as a plan (a step's look "gantt") or a board ("kanban"), from the same parts as the boxes: each part
// that holds work is a row, named by its box at the left; its work is a bar for each piece, one after another along
// the row (gantt), or a card in the column of its status, the rows being lanes (kanban). A bar and a card are both
// boxes, so one moves into the other. Pure: a layout in, geometry out. Every length is the style's (arch_board_*).

import { hashOf } from './islands.js';

/** How a plan or a board looks beyond its marks: its bars and cards, its lines and its columns' names. */
export const css = `
.sp-task .ar-shape { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-flow-stroke); }
.sp-task text { fill: var(--ln-text); font-size: var(--ln-arch-says-text); font-family: var(--ln-font); dominant-baseline: middle; }
.sp-board line { stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.sp-board text { fill: var(--ln-muted); font-size: var(--ln-arch-place-text); font-weight: 600; font-family: var(--ln-font); text-anchor: middle; dominant-baseline: middle; }
`;

/**
 * A layout (layout.js) as a plan or a board: where each part sits (x, y, as row names), each piece of work in it
 * (tasks: id to { x, y, w, h, item }, by its middle), the lines and the column names (heads) to draw, and the size.
 * `order` is the statuses in the order the board's columns go, `names` what each is called.
 */
export function board(look, g, { z, order, names }) {
  const parts = g.all.filter((n) => !n.dummy).sort((a, b) => (a.item.place ?? 0) - (b.item.place ?? 0));
  const [MARGIN, GAP, PAD, HEAD] = ['margin', 'board_gap', 'board_pad', 'board_head'].map((n) => z(n));
  const label = Math.max(0, ...parts.map((n) => n.w));
  const left = MARGIN + label + GAP;
  const x = new Map(), y = new Map(), tasks = new Map(), lines = [], heads = [];
  const work = (n) => [...(n.notes ?? [])].sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  // Along a plan, what is done comes first, then what is under way, then what is to do.
  const when = (n) => [...work(n)].sort((a, b) => order.indexOf(b.status) - order.indexOf(a.status));
  let top = MARGIN + HEAD, right = left;
  if (look === 'gantt') {
    // A row each; its work one bar after another, from where the part begins (each begins a little apart).
    const [UNIT, BAR] = [z('board_unit'), z('board_bar')];
    for (const n of parts) {
      const row = Math.max(n.h, BAR) + GAP, mid = top + row / 2, start = left + Math.floor(hashOf(n.id) * 3) * (UNIT / 2);
      (x.set(n.id, MARGIN + n.w / 2), y.set(n.id, mid));
      when(n).forEach((t, k) => tasks.set(t.id, { x: start + k * UNIT + UNIT / 2, y: mid, w: UNIT - PAD / 2, h: BAR, item: t }));
      right = Math.max(right, start + work(n).length * UNIT);
      top += row;
    }
    // A line down at each step of time.
    for (let at = left; at <= right + 0.5; at += UNIT) lines.push([at, MARGIN + HEAD / 2, at, top]);
  } else {
    // A lane each; in each lane a column for each status, the cards in it one under another.
    const [CARD, HIGH] = [z('board_card'), z('board_card_high')], COL = CARD + 2 * PAD;
    order.forEach((v, k) => heads.push({ key: v, text: String(names[v] ?? v), x: left + k * COL + COL / 2, y: MARGIN + HEAD / 2 }));
    for (const n of parts) {
      const cells = order.map((v) => work(n).filter((t) => t.status === v));
      const row = Math.max(n.h + GAP, ...cells.map((c) => c.length * (HIGH + PAD / 2) + PAD));
      (x.set(n.id, MARGIN + n.w / 2), y.set(n.id, top + row / 2));
      cells.forEach((cell, k) => cell.forEach((t, i) => tasks.set(t.id, { x: left + k * COL + COL / 2, y: top + PAD / 2 + i * (HIGH + PAD / 2) + HIGH / 2, w: CARD, h: HIGH, item: t })));
      lines.push([MARGIN, top + row, left + order.length * COL, top + row]);
      top += row;
    }
    right = left + order.length * COL;
    for (let k = 1; k < order.length; k++) lines.push([left + k * COL, MARGIN + HEAD / 2, left + k * COL, top]);
  }
  return { ...g, x, y, tasks, lines, heads, chains: [], boxes: [], breaks: [], left: 0, width: right + MARGIN, height: top + MARGIN };
}
