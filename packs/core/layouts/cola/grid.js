// The lines a cola picture's wires may run on (task e_x7kwbu3e): an orthogonal visibility grid, as libavoid builds, not
// WebCola's GridRouter's, whose lines run through the middles between box centres and so, where boxes are not in rows
// and columns, through other boxes. Here every box gives a line along each side, `room` out from it, and one through its
// middle, and every island frame a line `room` outside each side: so there is always a lane round a box. A point of the
// grid inside a box, or within half its room of it, is closed. Each wire then takes the cheapest way on it: its length, and `bend`
// for each turn. Pure: boxes and frames in, paths of shared points out.
// Layer: metrics.

/**
 * The lines through , sorted, those nearer than  made one (at the middle of what they gather): two wires
 * on lines a hair apart would run on one another, where on one line they are parted into channels.
 */
function lines(values, merge) {
  const sorted = [...values].sort((a, b) => a - b), out = [];
  for (let k = 0; k < sorted.length;) {
    let n = k;
    while (n + 1 < sorted.length && sorted[n + 1] - sorted[k] < merge) n++;
    out.push((sorted[k] + sorted[n]) / 2);
    k = n + 1;
  }
  return out;
}

/** The index of the line in sorted `list` nearest `v`. */
function near(list, v) {
  const k = at(list, v);
  return k > 0 && (k === list.length || v - list[k - 1] < list[k] - v) ? k - 1 : k;
}

/** The first index in sorted `list` at or after `v`. */
function at(list, v) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < v - 0.01) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The grid: its lines `xs` and `ys`, which points are closed, and a point object per open crossing, shared by every path. */
export function gridOf(boxes, frames, room, merge) {
  const xs = lines([...boxes.flatMap((b) => [b.x - b.w / 2 - room, b.x, b.x + b.w / 2 + room]), ...frames.flatMap((f) => [f.l - room, f.r + room])], merge);
  const ys = lines([...boxes.flatMap((b) => [b.y - b.h / 2 - room, b.y, b.y + b.h / 2 + room]), ...frames.flatMap((f) => [f.t - room, f.b + room])], merge);
  const closed = new Uint8Array(xs.length * ys.length);
  for (const b of boxes) {
    const i0 = at(xs, b.x - b.w / 2 - room / 2), i1 = at(xs, b.x + b.w / 2 + room / 2), j0 = at(ys, b.y - b.h / 2 - room / 2), j1 = at(ys, b.y + b.h / 2 + room / 2);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) closed[i * ys.length + j] = 1;
  }
  const points = new Map();
  const point = (i, j) => points.get(i * ys.length + j) ?? points.set(i * ys.length + j, { x: xs[i], y: ys[j] }).get(i * ys.length + j);
  return { xs, ys, closed, point };
}

/** A binary heap of [cost, value], the cheapest first. */
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(c, v) { a.push([c, v]); let n = a.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (a[p][0] <= a[n][0]) break; [a[p], a[n]] = [a[n], a[p]]; n = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let s = n; if (l < a.length && a[l][0] < a[s][0]) s = l; if (r < a.length && a[r][0] < a[s][0]) s = r; if (s === n) break; [a[s], a[n]] = [a[n], a[s]]; n = s; } }
      return top;
    },
  };
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Each way a wire may go, as its index in STEPS. */
const [RIGHT, LEFT, DOWN, UP] = STEPS.keys();

/**
 * The cheapest way on the grid from any of `starts` to any of `ends` (each { i, j, d }: a crossing and the direction,
 * 0 to 3 as in STEPS, a wire leaves or comes in by), where `open(i, j)` says whether the wire may pass a crossing.
 * Answers the crossings in order, or null where there is no way.
 */
export function cheapest(grid, starts, ends, open, bend) {
  const { xs, ys, closed } = grid, H = ys.length;
  const goal = new Map(ends.map((e) => [e.i * H + e.j, e.d]));
  const far = (i, j) => Math.min(...ends.map((e) => Math.abs(xs[i] - xs[e.i]) + Math.abs(ys[j] - ys[e.j])));
  const best = new Map(), from = new Map(), q = heap();
  for (const s of starts) { const k = (s.i * H + s.j) * 4 + s.d; best.set(k, 0); q.push(far(s.i, s.j), k); }
  while (q.size) {
    const [, k] = q.pop(), d = k % 4, v = (k - d) / 4, i = Math.floor(v / H), j = v % H, cost = best.get(k);
    if (goal.has(v) && goal.get(v) === d) {
      const path = [];
      for (let c = k; c !== undefined; c = from.get(c)) { const w = (c - (c % 4)) / 4; path.push([Math.floor(w / H), w % H]); }
      return path.reverse().filter((p, n, all) => n === 0 || p[0] !== all[n - 1][0] || p[1] !== all[n - 1][1]);
    }
    for (let e = 0; e < STEPS.length; e++) {
      if ((e ^ 1) === d && e !== d) continue;
      const ni = i + STEPS[e][0], nj = j + STEPS[e][1];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= H || closed[ni * H + nj] || !open(ni, nj)) continue;
      const nk = (ni * H + nj) * 4 + e, nc = cost + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (e === d ? 0 : bend);
      if (nc < (best.get(nk) ?? Infinity)) { best.set(nk, nc); from.set(nk, k); q.push(nc + far(ni, nj), nk); }
    }
  }
  return null;
}

/** Where a wire may leave or come into a box: the middle of each side its room out, with the direction it goes. */
export function doorsOf(grid, box, room, sides) {
  const { xs, ys } = grid, i = near(xs, box.x), j = near(ys, box.y);
  const all = {
    bottom: { i, j: near(ys, box.y + box.h / 2 + room), d: DOWN }, top: { i, j: near(ys, box.y - box.h / 2 - room), d: UP },
    right: { i: near(xs, box.x + box.w / 2 + room), j, d: RIGHT }, left: { i: near(xs, box.x - box.w / 2 - room), j, d: LEFT },
  };
  return sides.map((s) => ({ ...all[s], side: s }));
}
