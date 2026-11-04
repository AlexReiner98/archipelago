// What stands, set out for drawing: what the solve left, every wire landed on its outline, and the picture's size. Layer:
// metrics, its last step. Pure: places in, a layout's answer out.

import { count } from './count.js';
import { upright } from './polyline.js';
import { landOn } from './shapes.js';

/** The layout, from where the solve left each box and wire. Nothing is put by hand: a view is drawn from its query alone. */
export const finisher = ({ nodes, potential, chains, ties, x, y, routes, margin, stepSize }) => {
  /** A line from `w.a` to `w.b`, its ends on the outlines that are drawn, not on the boxes round them. */
  const landed = (w, r, line, x, y) => {
    const edge = (id, to) => {
      const s = stepSize(id), [px, py] = [x.get(id), y.get(id)], dx = to[0] - px, dy = to[1] - py, t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity, 1);
      return [px + dx * t, py + dy * t];
    };
    const p = line ? (r.from === w.a ? line : [...line].reverse()) : [edge(w.a, [x.get(w.b), y.get(w.b)]), edge(w.b, [x.get(w.a), y.get(w.a)])];
    if (!x.has(w.a) || !x.has(w.b)) return p;
    const first = landOn(nodes.get(w.a), x.get(w.a), y.get(w.a), p[0], p[1]), final = landOn(nodes.get(w.b), x.get(w.b), y.get(w.b), p.at(-1), p.at(-2));
    return p.map((q, i) => (i === 0 ? first : i === p.length - 1 ? final : q));
  };
  const standing = (w) => ({ ...w, headAt: 'end', points: landed(w, routes.get(w.route), routes.get(w.route)?.points, x, y) });
  const wired = chains.map(standing), tied = ties.map(standing);
  const all = [...nodes.values()].filter((n) => x.has(n.id));
  const place = () => {
    const every = [...wired, ...tied], drawnPoints = every.flatMap((w) => w.points);
    // Where two wires cross one passes under: a tie under a wire of the order, else what runs up or down.
    const breaks = count(every.map((w) => w.points)).where, gaps = new Map();
    for (const { lines: [p, q], at } of breaks) {
      const [a, b] = [every[p], every[q]], under = !a.type !== !b.type ? (a.type ? a : b) : upright(a.points, at) ? a : b;
      (gaps.get(under) ?? gaps.set(under, []).get(under)).push(at);
    }
    const cut = (w) => (gaps.has(w) ? { ...w, gaps: gaps.get(w) } : w);
    const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
    const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
    return { nodes, all, chains: wired.map(cut), ties: tied.map(cut), breaks, potential, x, y, width, height };
  };
  return () => {
    const laid = place(), own = (w) => ({ ...w, points: w.points.map((p) => [...p]) });
    return { ...laid, chains: laid.chains.map(own), ties: laid.ties.map(own) };
  };
};
