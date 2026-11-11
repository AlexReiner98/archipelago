// The rails: a view's items laid out as a map with a camera path through them in the view's order. Every coordinate is
// set here: each stop's box on the grid ./grid.js gives, each wire's lane and track, the rail between stops that follow
// one another, and the stops the camera walks (each item's centre, and how wide a stretch of the picture it frames).
// Layer: metrics. Pure: the layout's args in, the model out; every length is a size on the style (rails_*).

import { boxOf } from './boxes.js';
import { grid } from './grid.js';
import { readingOrder, roles } from './order.js';

/** Lanes for stretches along one line, each a lane of its own unless it stands `gap` clear of the last in a lane. */
function lanesOf(spans, gap) {
  const last = [], out = new Map();
  for (const s of [...spans].sort((p, q) => p.lo - q.lo || p.hi - q.hi)) {
    const k = last.findIndex((hi) => hi + gap <= s.lo);
    const lane = k >= 0 ? k : last.length;
    last[lane] = s.hi;
    out.set(s, lane);
  }
  return { lane: out, count: last.length };
}

/** What `count` lines a gap apart need, `room` clear of what stands on each side, and never less than `least`. */
const across = (count, sizes, least) => (count ? Math.max(least, 2 * sizes.rails_wire_room + (count - 1) * sizes.rails_wire_gap) : least);

/** A note's first paragraph, plain, for a stop's words. */
const noteOf = (i) => String(i.body ?? i.gist ?? '').split(/\r?\n\s*\r?\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';

/**
 * The model: `boxes` by id (centre, size, lines, number), `wires` (each link's points, from its from to its to),
 * `rails` (between each two stops that follow one another, with the link it carries, if any), `stops` in order,
 * `whole` (the camera on everything) and `size`.
 */
export function layout({ items, links, measure, sizes, numbers = {} }) {
  const GAP = sizes.rails_wire_gap, ROOM = sizes.rails_wire_room, M = sizes.rails_margin;
  const order = readingOrder(items, links), { riding, wires } = roles(order, links);
  const g = grid(order.length, Math.max(1, Math.round(numbers.rails_columns ?? 1)), wires);
  const most = Math.max(1, Math.round(numbers.rails_lines_most ?? 1));
  const sized = order.map((i) => boxOf(i, measure, sizes, most));
  // Each column as wide as its widest name and its slots need; each row as tall as its tallest name.
  const colW = Array.from({ length: g.columns }, (_, c) => Math.max(...sized.filter((_, k) => g.cells[k].column === c).map((b) => b.w), 2 * (g.need[c] + 1) * GAP));
  const rowH = Array.from({ length: g.rows }, (_, r) => Math.max(...sized.filter((_, k) => g.cells[k].row === r).map((b) => b.h)));
  // Across: a margin, then each gap between columns (the outer two only as wide as their tracks) and each column.
  const gapW = g.tracks.map((t, j) => across(t, sizes, j === 0 || j === g.columns ? 0 : sizes.rails_column_gap));
  const gapL = [], colX = [];
  let x = M;
  for (let j = 0; j <= g.columns; j++) {
    gapL.push(x);
    x += gapW[j];
    if (j < g.columns) (colX.push(x + colW[j] / 2), (x += colW[j]));
  }
  const width = x + M;
  const slotX = (column, slot) => colX[column] + slot * GAP;
  const trackX = (w) => gapL[w.gap] + (gapW[w.gap] - (g.tracks[w.gap] - 1) * GAP) / 2 + w.track * GAP;
  // Each stretch along a gutter, by gutter: lanes, then how tall the gutter is.
  const spans = Array.from({ length: g.rows }, () => []);
  const span = (row, a, b, w, leg) => spans[row].push({ lo: Math.min(a, b), hi: Math.max(a, b), w, leg });
  for (const w of g.wires) {
    const xe = slotX(w.e.column, w.eSlot), xl = slotX(w.l.column, w.lSlot);
    if (w.kind === 'far') (span(w.e.row, xe, trackX(w), w, 0), span(w.l.row - 1, trackX(w), xl, w, 1));
    else span(w.e.row, xe, xl, w, 0);
  }
  const laned = spans.map((s) => lanesOf(s, GAP)), legY = new Map();
  const gutterH = laned.map((l, r) => across(l.count, sizes, r === g.rows - 1 ? 0 : sizes.rails_row_gap));
  const rowT = [];
  let y = M;
  for (let r = 0; r < g.rows; r++) (rowT.push(y), (y += rowH[r] + gutterH[r]));
  const height = y + M, foot = (r) => rowT[r] + rowH[r], top = (r) => rowT[r];
  laned.forEach((l, r) => {
    const first = foot(r) + (gutterH[r] - (l.count - 1) * GAP) / 2;
    for (const [s, lane] of l.lane) legY.set(`${s.w.early} ${s.w.late} ${s.w.link.id} ${s.leg}`, first + lane * GAP);
  });
  const laneOf = (w, leg) => legY.get(`${w.early} ${w.late} ${w.link.id} ${leg}`);

  const boxes = new Map(order.map((i, k) => {
    const { row, column } = g.cells[k];
    return [i.id, { id: i.id, item: i, n: k + 1, lines: sized[k].lines, x: colX[column], y: rowT[row] + rowH[row] / 2, w: colW[column], h: rowH[row] }];
  }));
  const drawnWires = g.wires.map((w) => {
    const xe = slotX(w.e.column, w.eSlot), xl = slotX(w.l.column, w.lSlot), y0 = foot(w.e.row), lane = laneOf(w, 0);
    let points;
    if (w.kind === 'row') points = [[xe, y0], [xe, lane], [xl, lane], [xl, foot(w.l.row)]];
    else if (w.kind === 'next') points = [[xe, y0], [xe, lane], [xl, lane], [xl, top(w.l.row)]];
    else {
      const tx = trackX(w), down = laneOf(w, 1);
      points = [[xe, y0], [xe, lane], [tx, lane], [tx, down], [xl, down], [xl, top(w.l.row)]];
    }
    // Points run from the link's from to its to, where its head is.
    const forward = order[w.early].id === w.link.from;
    return { id: w.link.id, type: w.link.type, a: w.link.from, b: w.link.to, points: forward ? points : points.reverse() };
  });
  const rails = order.slice(1).map((i, k) => {
    const p = boxes.get(order[k].id), q = boxes.get(i.id), link = riding.get(k);
    const points = g.cells[k].row === g.cells[k + 1].row
      ? [[p.x + Math.sign(q.x - p.x) * p.w / 2, p.y], [q.x - Math.sign(q.x - p.x) * q.w / 2, q.y]]
      : [[p.x, p.y + p.h / 2], [q.x, q.y - q.h / 2]];
    const forward = !link || link.from === p.id;
    return { a: p.id, b: q.id, ...(link && { link: { id: link.id, type: link.type, from: link.from, to: link.to } }), points: forward ? points : points.reverse() };
  });
  // The camera: on each stop's centre, framing rails_stop_span of the picture across (never less than its box and a
  // column gap each side); `zoom` is how much nearer that is than the whole picture.
  const stops = order.map((i) => {
    const b = boxes.get(i.id), frame = Math.max(sizes.rails_stop_span, b.w + 2 * sizes.rails_column_gap);
    return { id: i.id, title: i.title, note: noteOf(i), x: b.x, y: b.y, span: frame, zoom: width / frame };
  });
  return { order, boxes, wires: drawnWires, rails, stops, whole: { x: width / 2, y: height / 2, span: width, zoom: 1 }, size: { width, height } };
}
