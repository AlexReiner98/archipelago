// What stands, set out for drawing: the pins set on what the solve left (./pins.js), every wire landed on its outline, and the
// picture's size. Each wire that nothing moved is worked out once, so a drag frame costs only what it moves. Layer: metrics,
// its last step. Pure: places in, a layout's answer out.

import { count } from './count.js';
import { runsUp } from './faults.js';
import { pinner } from './pins.js';
import { upright } from './polyline.js';
import { landOn } from './shapes.js';

/**
 * Answers a function of `placed`, where steps were put by hand: the layout and what the key says of it, in `seen`. The
 * layout's `place(placed)` is the same picture with other pins, shared with this one and not to be changed.
 */
export const finisher = ({ nodes, potential, chains, ties, x: pulledX, y: pulledY, routes, rigid, headless, z, margin, stepSize, reshape, tally }) => {
  const pinned = pinner({ nodes, x: pulledX, y: pulledY, routes, rigid, reshape, lengths: { wire: z.turn, room: z.room, run: z.run, corner: z.corner, apart: z.gap / 2, join: z.join, rounds: z.pin_rounds } });
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
  const standing = (w) => ({ ...w, headAt: 'end', points: landed(w, routes.get(w.route), routes.get(w.route)?.points, pulledX, pulledY) });
  const firstChains = chains.map(standing), firstTies = ties.map(standing);
  const all = [...nodes.values()].filter((n) => pulledX.has(n.id));
  const place = (placed) => {
    const { x, y, moved, lines, told } = pinned(placed);
    const now = (w) => {
      const k = w.route, line = lines.get(k);
      return line || ((moved.has(w.a) || moved.has(w.b)) && !routes.has(k)) ? { ...w, points: landed(w, routes.get(k), line, x, y) } : w;
    };
    const wired = firstChains.map(now), tied = firstTies.map(now), every = [...wired, ...tied], drawnPoints = every.flatMap((w) => w.points);
    // Where two wires cross one passes under: a tie under a wire of the order, else what runs up or down.
    const breaks = count(every.map((w) => w.points)).where, gaps = new Map();
    for (const { lines: [p, q], at } of breaks) {
      const [a, b] = [every[p], every[q]], under = !a.type !== !b.type ? (a.type ? a : b) : upright(a.points, at) ? a : b;
      (gaps.get(under) ?? gaps.set(under, []).get(under)).push(at);
    }
    const cut = (w) => (gaps.has(w) ? { ...w, gaps: gaps.get(w) } : w);
    const width = Math.max(0, ...all.map((n) => x.get(n.id) + n.w / 2), ...drawnPoints.map((p) => p[0])) + margin;
    const height = Math.max(0, ...all.map((n) => y.get(n.id) + n.h / 2), ...drawnPoints.map((p) => p[1])) + margin;
    return { nodes, all, chains: wired.map(cut), ties: tied.map(cut), breaks, potential, x, y, width, height, place, told };
  };
  return (placed) => {
    const laid = place(placed), own = (w) => ({ ...w, points: w.points.map((p) => [...p]) }), wires = [...laid.chains, ...laid.ties];
    const rectOf = (id) => { const n = nodes.get(id); return { l: laid.x.get(id) - n.w / 2, r: laid.x.get(id) + n.w / 2, t: laid.y.get(id) - n.h / 2, u: laid.y.get(id) + n.h / 2 }; };
    const headed = wires.filter((w) => !headless.includes(w.type) && laid.x.has(w.a) && laid.x.has(w.b));
    const seen = { chains: laid.chains, ties: laid.ties, ...tally, headed: headed.length, up: headed.filter((w) => runsUp(rectOf(w.a), rectOf(w.b), w.points)).length };
    return { laid: { ...laid, chains: laid.chains.map(own), ties: laid.ties.map(own) }, seen };
  };
};
