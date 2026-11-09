// The sea between blocks that stand side by side (task e_3svu8hbh): a strip's columns, or the islands' bands. A link
// between two blocks leaves the left one by its right side and comes into the right one by its left: it runs down a
// lane of the gap between them when they stand side by side, else up a lane of the gap beside each to a track over all
// the blocks and along it. An end may be a picture's edge instead of a block (a link leaving a strip cut into columns
// for another island), reached by a track. Each gap's lanes and the tracks are packed as a gutter's are
// (./lanes.js); links that share an end (`share`) share their lane in the gap beside it, as a trunk. Layer: metrics.
// Pure: widths and routes in, where each block stands and each route's points out.

import { lanes } from './lanes.js';

/**
 * `widths`: each block's width, the blocks left to right, their tops at y 0. `routes`: { key, i, j, yl, yr, share,
 * at }: from block i's right side at yl to block j's left side at yr, i < j; i -1 is the left edge and j the count of
 * blocks the right edge, where y is not needed. `share` names a trunk and `at` ('l' or 'r') the end it shares.
 * `least` is the narrowest a gap may be. Answers `left` (each block's x), `over` (how far every y moves down for the
 * tracks), `width`, and `points`: each route's line from its left end to its right, moved.
 */
export function sea({ widths, routes, sizes, least }) {
  const WIRE = sizes.flow_wire_gap, ROOM = sizes.flow_wire_room, n = widths.length, TOP = -Infinity;
  // Each route's stretch down each gap it uses: the whole of it between two blocks side by side, else from the top.
  const entries = widths.slice(1).map(() => new Map());
  const enter = (gap, r, end, span) => {
    const shared = r.share !== undefined && (end === r.at || end === 'both');
    const key = shared ? `share:${r.share}` : `${r.key}:${end}`, list = entries[gap];
    const was = list.get(key);
    list.set(key, was ? { ...was, span: [Math.min(was.span[0], span[0]), Math.max(was.span[1], span[1])], routes: [...was.routes, [r.key, end]] } : { span, routes: [[r.key, end]] });
  };
  for (const r of routes) {
    if (r.j === r.i + 1) enter(r.i, r, 'both', [Math.min(r.yl, r.yr), Math.max(r.yl, r.yr)]);
    else {
      if (r.i >= 0) enter(r.i, r, 'l', [TOP, r.yl]);
      if (r.j < n) enter(r.j - 1, r, 'r', [TOP, r.yr]);
    }
  }
  const packed = entries.map((list) => lanes([...list.values()].map((e) => e.span), WIRE));
  // A route's stub from the left block runs from its edge to its lane, one into the right block from its lane on: where
  // the two stand within a wire of one another, the one leaving must have its lane left of the one coming in. Lanes
  // trade places while that puts fewer such pairs right.
  const ys = (key, end) => { const r = routes.find((q) => q.key === key); return end === 'both' ? { l: [r.yl], r: [r.yr] } : end === 'l' ? { l: [r.yl], r: [] } : { l: [], r: [r.yr] }; };
  entries.forEach((list, gap) => {
    const stubs = [...list.values()].map((e) => e.routes.map(([key, end]) => ys(key, end)).reduce((s, q) => ({ l: [...s.l, ...q.l], r: [...s.r, ...q.r] }), { l: [], r: [] }));
    const lane = packed[gap].lane, near = (p, q) => p.some((a) => q.some((b) => Math.abs(a - b) < WIRE));
    const wrong = () => stubs.reduce((n, s, a) => n + stubs.filter((t, b) => lane[b] < lane[a] && near(s.l, t.r)).length, 0);
    let now = wrong();
    for (let pass = 0; now && pass < packed[gap].count; pass++) {
      for (let p = 0; p < packed[gap].count; p++) for (let q = p + 1; q < packed[gap].count; q++) {
        const swap = () => lane.forEach((v, k) => (lane[k] = v === p ? q : v === q ? p : v));
        swap();
        const then = wrong();
        if (then < now) now = then;
        else swap();
      }
    }
  });
  const gapWidth = packed.map((p) => Math.max(least, 2 * ROOM + Math.max(0, p.count - 1) * WIRE));
  const left = [];
  let cursor = 0;
  widths.forEach((w, k) => ((left[k] = cursor), (cursor += w + (gapWidth[k] ?? 0))));
  const laneX = new Map();
  entries.forEach((list, gap) => [...list.values()].forEach((e, k) => {
    const x = left[gap] + widths[gap] + (gapWidth[gap] - (packed[gap].count - 1) * WIRE) / 2 + packed[gap].lane[k] * WIRE;
    for (const [key, end] of e.routes) laneX.set(`${key}:${end}`, x);
  }));
  // The tracks over the blocks, for routes between blocks that do not stand side by side.
  const edge = (r, end) => (end === 'l' ? (r.i < 0 ? 0 : laneX.get(`${r.key}:l`)) : r.j >= n ? cursor : laneX.get(`${r.key}:r`));
  const far = routes.filter((r) => r.j > r.i + 1);
  const tracks = lanes(far.map((r) => [edge(r, 'l'), edge(r, 'r')]), WIRE);
  const over = tracks.count ? ROOM + tracks.count * WIRE : 0;
  const trackY = new Map(far.map((r, k) => [r.key, over - ROOM - tracks.lane[k] * WIRE]));
  const points = new Map(routes.map((r) => {
    if (r.j === r.i + 1) { const x = laneX.get(`${r.key}:both`); return [r.key, [[x, r.yl + over], [x, r.yr + over]]]; }
    const [xl, xr, ty] = [edge(r, 'l'), edge(r, 'r'), trackY.get(r.key)];
    return [r.key, [...(r.i >= 0 ? [[xl, r.yl + over]] : []), [xl, ty], [xr, ty], ...(r.j < n ? [[xr, r.yr + over]] : [])]];
  }));
  return { left, over, width: cursor, points };
}
