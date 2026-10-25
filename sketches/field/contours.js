// Where the field crosses a level, as closed curves: marching squares over the field laid out three by three,
// so every curve that reaches the middle tile is whole there. One path per level, filled even-odd.

import { closed } from '../life/shapes.js';

// For each corner case (top-left 8, top-right 4, bottom-right 2, bottom-left 1): the edges each segment joins.
// Edges: 0 top, 1 right, 2 bottom, 3 left. Saddles (5, 10) are settled by the middle of the cell.
const CASES = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 6: [[0, 2]], 7: [[0, 3]], 8: [[0, 3]], 9: [[0, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };

/** The level t of field f as closed loops, in tile units (the tile is size wide); loops may run past the tile's edges. */
export function loops({ n, v }, t, size, pad = -1e9) {
  const m = 3 * n + 2;
  const at = (x, y) => (x <= 0 || y <= 0 || x >= m - 1 || y >= m - 1 ? pad : v[((y - 1) % n) * n + ((x - 1) % n)]);
  // An edge's key, and where on it the level falls.
  const hKey = (x, y) => 2 * (y * m + x), vKey = (x, y) => 2 * (y * m + x) + 1;
  const where = (key) => {
    const c = key >> 1, x = c % m, y = (c - x) / m;
    if (key & 1) { const a = at(x, y), b = at(x, y + 1); return [x, y + (t - a) / (b - a)]; }
    const a = at(x, y), b = at(x + 1, y);
    return [x + (t - a) / (b - a), y];
  };
  const link = new Map();
  const join = (a, b) => {
    (link.get(a) ?? link.set(a, []).get(a)).push(b);
    (link.get(b) ?? link.set(b, []).get(b)).push(a);
  };
  for (let y = 0; y < m - 1; y++) for (let x = 0; x < m - 1; x++) {
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    const c = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
    if (!c || c === 15) continue;
    const edges = [hKey(x, y), vKey(x + 1, y), hKey(x, y + 1), vKey(x, y)];
    const inside = (tl + tr + br + bl) / 4 >= t;
    const segs = c === 5 ? (inside ? [[0, 3], [2, 1]] : [[0, 1], [3, 2]]) : c === 10 ? (inside ? [[0, 1], [3, 2]] : [[0, 3], [2, 1]]) : CASES[c];
    for (const [a, b] of segs) join(edges[a], edges[b]);
  }
  // Walk each loop; keep those that touch the middle tile, in tile units, thinned to about one point a cell.
  const seen = new Set(), out = [], k = size / n;
  for (const start of link.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let prev = -1, cur = start;
    do {
      seen.add(cur);
      pts.push(where(cur));
      const [a, b] = link.get(cur);
      [prev, cur] = [cur, a !== prev ? a : b];
    } while (cur !== start && !seen.has(cur));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
    if (pts.length < 4 || x1 < n + 1 || x0 > 2 * n + 1 || y1 < n + 1 || y0 > 2 * n + 1) continue;
    const thin = pts.filter((p, i) => i % 2 === 0);
    out.push(thin.map(([x, y]) => [(x - n - 1) * k, (y - n - 1) * k]));
  }
  return out;
}

/** All of a level's loops as one even-odd path. */
export const levelPath = (field, t, size) => loops(field, t, size).map(closed).join('');
