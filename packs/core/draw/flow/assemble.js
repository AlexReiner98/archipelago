// The parts brought onto one plane: each drawn part's size, then every box, comb and line at its place, and what moves as one
// in the pull. Layer: metrics. Pure: drawn parts in, places out.

import { pair } from './polyline.js';
import { shelve } from './shelves.js';

/** What a drawn part takes up, its lines included. */
export function shelfOf(drawn, block) {
  const xs = [...drawn.places].flatMap(([id, [px]]) => [px - block(id).w / 2, px + block(id).w / 2]), ys = [...drawn.places].flatMap(([id, [, py]]) => [py, py + block(id).h]);
  const wired = [...drawn.points.values()].flatMap((r) => r.points);
  const l = Math.min(...xs, ...wired.map((p) => p[0])), t = Math.min(...ys, ...wired.map((p) => p[1]));
  return { drawn, l, t, w: Math.max(...xs, ...wired.map((p) => p[0])) - l, h: Math.max(...ys, ...wired.map((p) => p[1])) - t };
}

/** Every item's middle, every line, and the item of the core each kid hangs from, `shelves` set out in rows. */
export function assemble(shelves, { kids, combs, combGap, portOff, block, stepSize, gap, margin, aspect }) {
  const x = new Map(), y = new Map(), routes = new Map(), parents = new Map();
  /** The item of the core a tree hangs on. */
  const holder = (id) => (parents.has(id) ? holder(parents.get(id)) : id);
  const note = (at) => (kids.get(at) ?? []).forEach((k) => (parents.set(k, at), note(k)));
  shelves.sort((p, q) => q.h - p.h || q.w - p.w);
  shelve(shelves, { gap, margin, aspect }, (c, dx, dy) => {
    for (const [id, [px, py]] of c.drawn.places) {
      const s = stepSize(id), { down, up } = combs.get(id), b = block(id), boxX = px - b.w / 2 + s.w / 2 + dx, boxY = py + b.lead + s.h / 2 + dy;
      x.set(id, boxX);
      y.set(id, boxY);
      note(id);
      const ax = px - b.w / 2 + s.w + combGap + (b.w - s.w - combGap) / 2 + dx, off = portOff(id);
      for (const [hang, way] of [[down, 1], [up, -1]]) {
        // Each leaves the box at a port of its own when there are two.
        const at = boxY + way * off, map = ([p, q]) => [ax + p, at + way * q];
        for (const it of hang.items) (x.set(it.id, map([it.x, it.y])[0]), y.set(it.id, map([it.x, it.y])[1]));
        for (const [item, points] of hang.wires) {
          const from = parents.get(item), line = points.map(map);
          routes.set(pair(from, item), { from, points: from === id ? [[boxX + s.w / 2, line[0][1]], ...line.slice(line[0][0] === ax ? 1 : 0)] : line });
        }
      }
    }
    for (const [k, r] of c.drawn.points) routes.set(k, { from: r.from, to: r.to, set: c.drawn.set, points: r.points.map(([p, q]) => [p + dx, q + dy]) });
  });
  return { x, y, routes, holder };
}

/** A box and what hangs on it, as one for the pull. */
export function rigidOf({ combs, x, y, stepSize, block }) {
  const rigid = new Map();
  for (const [id, c] of combs) {
    if (!x.has(id)) continue;
    const s = stepSize(id), b = block(id), left = x.get(id) - s.w / 2, top = y.get(id) - s.h / 2 - b.lead;
    rigid.set(id, { at: [left + b.w / 2, top + b.h / 2], size: [b.w, b.h], reach: [[-b.w / 2, -b.w / 2 + s.w], [-b.h / 2 + b.lead, -b.h / 2 + b.lead + s.h]], was: [left + b.w / 2, top + b.h / 2], hangs: [...c.down.items, ...c.up.items].map((it) => it.id) });
  }
  return rigid;
}
