// The ways a wire can take through a picture that stands, for a step put somewhere its old shape does not reach: the lines
// beside every box, a little apart, and what it costs to go along each. A cheapest way passes the fewest wires, so it threads
// the faces of what is drawn as ./thread.js threads those of a graph; the solve then parts it from what it lies along. Layer:
// shape. Pure: rectangles and lines in, a line out.

const BLOCKED = 65535;

/** The first of sorted `list` not below `v`. */
function bound(list, v) {
  let [lo, hi] = [0, list.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The lines to go along: `must` exactly, `could` where they stand clear of those, and more where a gap is wider than `step`. */
function linesOf(must, could, step, near) {
  const kept = [...new Set(must)].sort((p, q) => p - q);
  for (const v of [...new Set(could)].sort((p, q) => p - q)) {
    const k = bound(kept, v);
    if ((k === kept.length || kept[k] - v >= near) && (!k || v - kept[k - 1] >= near)) kept.splice(k, 0, v);
  }
  return kept.flatMap((v, k) => {
    const over = k ? Math.ceil((v - kept[k - 1]) / step) : 1;
    return Array.from({ length: over }, (_, n) => (n === over - 1 ? v : kept[k - 1] + ((v - kept[k - 1]) * (n + 1)) / over));
  });
}

/**
 * The lines round `boxes` ({ l, r, t, u }, which no way passes) and how many stretches of `wires` (each a list of points)
 * each piece of them crosses. `tips` are points every way must be able to end on. `room` is how far off a box its lines go,
 * `step` the widest gap between lines and `near` the narrowest. A field with lines `close` to the boxes finds more ways and takes longer.
 */
export function fieldOf({ boxes, wires, tips, room, step, near, close = false }) {
  // Off each box by `room`; `close` beside it too, so a channel narrower than two rooms has a line: the solve centres what goes down it.
  const off = close ? [room, near / 2] : [room];
  const xs = linesOf(tips.map((p) => p[0]), boxes.flatMap((b) => off.flatMap((by) => [b.l - by, b.r + by])), step, near);
  const ys = linesOf(tips.map((p) => p[1]), boxes.flatMap((b) => off.flatMap((by) => [b.t - by, b.u + by])), step, near);
  const [nx, ny] = [xs.length, ys.length], across = new Uint16Array(nx * ny), down = new Uint16Array(nx * ny);
  const mark = (list, into, i0, i1, j0, j1) => {
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) into(i, j, list);
  };
  for (const b of boxes) {
    const [il, ir, jt, ju] = [bound(xs, b.l), bound(xs, b.r), bound(ys, b.t), bound(ys, b.u)];
    // What runs across on a line inside the box from the column before it to the one after, and so on down.
    mark(BLOCKED, (i, j) => (across[i + j * nx] = BLOCKED), Math.max(0, il - 1), ir, jt, ju);
    mark(BLOCKED, (i, j) => (down[i + j * nx] = BLOCKED), il, ir, Math.max(0, jt - 1), ju);
  }
  for (const w of wires) for (let k = 1; k < w.length; k++) {
    const [p, q] = [w[k - 1], w[k]];
    if (p[0] === q[0]) {
      const i = bound(xs, p[0]);
      if (i && i < nx) for (let j = bound(ys, Math.min(p[1], q[1])); j < ny && ys[j] < Math.max(p[1], q[1]); j++) if (across[i - 1 + j * nx] < BLOCKED - 1) across[i - 1 + j * nx]++;
    } else {
      const j = bound(ys, p[1]);
      if (j && j < ny) for (let i = bound(xs, Math.min(p[0], q[0])); i < nx && xs[i] < Math.max(p[0], q[0]); i++) if (down[i + (j - 1) * nx] < BLOCKED - 1) down[i + (j - 1) * nx]++;
    }
  }
  return { boxes, xs, ys, nx, ny, across, down, dist: new Float64Array(2 * nx * ny), prev: new Int32Array(2 * nx * ny) };
}

/** A least-first queue of states: after `pop`, what came off is `cost` and `state`. */
function queue() {
  let costs = new Float64Array(1024), states = new Int32Array(1024), n = 0;
  return {
    cost: 0,
    state: 0,
    get size() { return n; },
    push(cost, state) {
      if (n === costs.length) {
        const [c, t] = [new Float64Array(2 * n), new Int32Array(2 * n)];
        (c.set(costs), t.set(states), (costs = c), (states = t));
      }
      let k = n++;
      while (k) {
        const up = (k - 1) >> 1;
        if (costs[up] <= cost) break;
        ((costs[k] = costs[up]), (states[k] = states[up]), (k = up));
      }
      ((costs[k] = cost), (states[k] = state));
    },
    pop() {
      ((this.cost = costs[0]), (this.state = states[0]));
      const [cost, state] = [costs[--n], states[n]];
      let k = 0;
      for (let c = 1; c < n; c = 2 * k + 1) {
        if (c + 1 < n && costs[c + 1] < costs[c]) c++;
        if (costs[c] >= cost) break;
        ((costs[k] = costs[c]), (states[k] = states[c]), (k = c));
      }
      ((costs[k] = cost), (states[k] = state));
    },
  };
}

/**
 * Where a wire can leave `box` onto the field: by each side it may use, the line to a state of it. Straight out to a line of
 * the field where one comes out of that side, and from its middle or either end of it, turning once, to the nearest either way.
 */
function seedsOf({ boxes, xs, ys, nx, ny }, box, sides, inset, run) {
  const seeds = [], mid = [(box.l + box.r) / 2, (box.t + box.u) / 2];
  const passes = (p, q) => boxes.some((b) => Math.max(p[0], q[0]) > b.l && Math.min(p[0], q[0]) < b.r && Math.max(p[1], q[1]) > b.t && Math.min(p[1], q[1]) < b.u);
  const seed = (line, i, j, dir, more = 0) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny || line.some((p, k) => k && passes(line[k - 1], p))) return;
    seeds.push({ state: 2 * (i + j * nx) + dir, line, cost: more + line.reduce((sum, p, k) => sum + (k ? Math.abs(p[0] - line[k - 1][0]) + Math.abs(p[1] - line[k - 1][1]) : 0), 0) });
  };
  for (const [side, way] of [['top', -1], ['foot', 1]]) {
    if (!sides.includes(side)) continue;
    const edge = way > 0 ? box.u : box.t;
    // A full run out, or as far as there is room for where boxes stand close.
    for (const j of way > 0 ? [bound(ys, edge + run), bound(ys, edge + 1e-6)] : [bound(ys, edge - run + 1e-6) - 1, bound(ys, edge) - 1]) {
      if (j < 0 || j >= ny) continue;
      for (let i = bound(xs, box.l + inset); i < nx && xs[i] <= box.r - inset; i++) seed([[xs[i], edge], [xs[i], ys[j]]], i, j, 1, Math.abs(xs[i] - mid[0]));
      for (const x of [box.l + inset, mid[0], box.r - inset]) for (const i of [bound(xs, x) - 1, bound(xs, x)]) seed([[x, edge], [x, ys[j]]], i, j, 0, Math.abs(x - mid[0]));
    }
  }
  for (const [side, way] of [['left', -1], ['right', 1]]) {
    if (!sides.includes(side)) continue;
    const edge = way > 0 ? box.r : box.l;
    for (const i of way > 0 ? [bound(xs, edge + run), bound(xs, edge + 1e-6)] : [bound(xs, edge - run + 1e-6) - 1, bound(xs, edge) - 1]) {
      if (i < 0 || i >= nx) continue;
      for (let j = bound(ys, box.t + inset); j < ny && ys[j] <= box.u - inset; j++) seed([[edge, ys[j]], [xs[i], ys[j]]], i, j, 0, Math.abs(ys[j] - mid[1]));
      for (const y of [box.t + inset, mid[1], box.u - inset]) for (const j of [bound(ys, y) - 1, bound(ys, y)]) seed([[edge, y], [xs[i], y]], i, j, 1, Math.abs(y - mid[1]));
    }
  }
  return seeds;
}

/**
 * The cheapest way from `box` by `sides` to each of `goals`: a line from a point on the box to the goal, or null where none
 * goes. A turn costs `turn` and a wire crossed `cross`, on top of the length. `run` is how far a wire leaves a box before it
 * may turn, `inset` how far from a corner it lands, and no way goes through `avoid`.
 */
export function waysFrom(field, box, sides, goals, { turn, cross, run, inset, avoid = [] }) {
  const { xs, ys, nx, across, down, dist, prev } = field, open = queue(), ports = new Map();
  dist.fill(Infinity);
  prev.fill(-1);
  const wanted = new Map(goals.map(([gx, gy]) => [bound(xs, gx) + bound(ys, gy) * nx, false]));
  const walls = [box, ...avoid].map((b) => [bound(xs, b.l + 1e-6), bound(xs, b.r), bound(ys, b.t + 1e-6), bound(ys, b.u)]);
  const inside = (i, j) => {
    for (let k = 0; k < walls.length; k++) if (i >= walls[k][0] && i < walls[k][1] && j >= walls[k][2] && j < walls[k][3]) return true;
    return false;
  };
  for (const s of seedsOf(field, box, sides, inset, run)) if (s.cost < dist[s.state]) ((dist[s.state] = s.cost), ports.set(s.state, s.line), open.push(s.cost, s.state));
  const reach = (state, cost, from) => {
    if (cost >= dist[state]) return;
    ((dist[state] = cost), (prev[state] = from), open.push(cost, state));
  };
  let left = wanted.size;
  while (open.size && left) {
    open.pop();
    const { cost, state } = open;
    if (cost > dist[state]) continue;
    const dir = state & 1, node = state >> 1, i = node % nx, j = (node - i) / nx;
    if (wanted.get(node) === false) (wanted.set(node, true), left--);
    reach(state ^ 1, cost + turn, state);
    if (dir === 0) {
      if (i + 1 < nx && across[node] !== BLOCKED && !inside(i + 1, j)) reach(state + 2, cost + xs[i + 1] - xs[i] + across[node] * cross, state);
      if (i > 0 && across[node - 1] !== BLOCKED && !inside(i - 1, j)) reach(state - 2, cost + xs[i] - xs[i - 1] + across[node - 1] * cross, state);
    } else {
      if (j + 1 < field.ny && down[node] !== BLOCKED && !inside(i, j + 1)) reach(state + 2 * nx, cost + ys[j + 1] - ys[j] + down[node] * cross, state);
      if (j > 0 && down[node - nx] !== BLOCKED && !inside(i, j - 1)) reach(state - 2 * nx, cost + ys[j] - ys[j - 1] + down[node - nx] * cross, state);
    }
  }
  return goals.map(([gx, gy]) => {
    const node = bound(xs, gx) + bound(ys, gy) * nx, state = dist[2 * node] <= dist[2 * node + 1] ? 2 * node : 2 * node + 1;
    if (dist[state] === Infinity) return null;
    const line = [];
    const spot = (at) => [xs[(at >> 1) % nx], ys[Math.floor((at >> 1) / nx)]];
    let at = state;
    for (; prev[at] >= 0; at = prev[at]) line.unshift(spot(at));
    return [...ports.get(at), spot(at), ...line];
  });
}
