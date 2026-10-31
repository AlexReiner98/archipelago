// A Gray-Scott reaction-diffusion field to grow land from, on a grid that wraps at every edge, and the islands
// it makes gathered into archipelagos. Input in, numbers out; no page.

const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The spectrum the pattern dial runs along: dividing spots (0), worms (0.5), coral labyrinth (1). */
export const rates = (t) => ({ feed: 0.0367 + (0.0545 - 0.0367) * t, kill: 0.0649 + (0.062 - 0.0649) * t });

/** Smooth noise over the torus, 0 to 1: a few random values per side, eased between, wrapping. */
function torusNoise(nx, ny, cells, rnd) {
  const gx = cells, gy = Math.max(1, Math.round((cells * ny) / nx)), g = Array.from({ length: gx * gy }, rnd);
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / nx) * gx, fy = (y / ny) * gy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = s(fx - x0), ty = s(fy - y0);
    const at = (i, j) => g[(((j % gy) + gy) % gy) * gx + (((i % gx) + gx) % gx)];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
}

/**
 * A Gray-Scott grid on an nx × ny torus, seeded, that grows on from where it stands by `run(steps, pattern)`.
 * `resize` carries what has grown onto a grid of another size: forms keep their width in cells, so on a coarser grid
 * they are wider on the page, and the chemistry merges or thins them as it runs on. That is what the scale dial is.
 */
function growing({ nx, ny, variety, seed }) {
  const rnd = random(seed * 104729 + 7);
  let size = nx * ny, drifts, feedAt, killAt, nb;
  let u = new Float32Array(size).fill(1), v = new Float32Array(size), u2 = new Float32Array(size), v2 = new Float32Array(size);
  const driftAt = torusNoise(1000, 1000, 3, random(seed * 7 + 11));
  // What belongs to the grid: where the pattern drifts, by place on the page, and each cell's eight neighbours, wrapped.
  const lay = () => {
    size = nx * ny;
    drifts = Float32Array.from({ length: size }, (_, i) => variety * 1.6 * (driftAt(((i % nx) / nx) * 1000, (Math.floor(i / nx) / ny) * 1000) - 0.5));
    feedAt = new Float32Array(size);
    killAt = new Float32Array(size);
    nb = new Int32Array(size * 8);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (y * nx + x) * 8;
      [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy], k) => (nb[i + k] = ((y + dy + ny) % ny) * nx + ((x + dx + nx) % nx)));
    }
  };
  lay();
  // Seeds: small squares of the second chemical, enough that the field fills fast.
  for (let s = 0; s < 6 + Math.round(size / 300); s++) {
    const cx = Math.floor(rnd() * nx), cy = Math.floor(rnd() * ny), r = 1 + Math.floor(rnd() * 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = ((cy + dy + ny) % ny) * nx + ((cx + dx + nx) % nx);
      (u[i] = 0.5), (v[i] = 0.25 + rnd() * 0.1);
    }
  }
  const resize = (nx2, ny2) => {
    const carried = (w) => Float32Array.from({ length: nx2 * ny2 }, (_, i) => sample({ nx, ny, v: w }, ((i % nx2) * nx) / nx2, (Math.floor(i / nx2) * ny) / ny2));
    [u, v] = [carried(u), carried(v)];
    [nx, ny] = [nx2, ny2];
    [u2, v2] = [new Float32Array(nx * ny), new Float32Array(nx * ny)];
    lay();
  };
  const run = (steps, pattern) => {
    for (let i = 0; i < size; i++) {
      const t = Math.max(-0.6, Math.min(2.2, pattern + drifts[i]));
      ({ feed: feedAt[i], kill: killAt[i] } = rates(t));
    }
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < size; i++) {
        const j = i * 8, ui = u[i], vi = v[i];
        const lu = 0.2 * (u[nb[j]] + u[nb[j + 1]] + u[nb[j + 2]] + u[nb[j + 3]]) + 0.05 * (u[nb[j + 4]] + u[nb[j + 5]] + u[nb[j + 6]] + u[nb[j + 7]]) - ui;
        const lv = 0.2 * (v[nb[j]] + v[nb[j + 1]] + v[nb[j + 2]] + v[nb[j + 3]]) + 0.05 * (v[nb[j + 4]] + v[nb[j + 5]] + v[nb[j + 6]] + v[nb[j + 7]]) - vi;
        const uvv = ui * vi * vi;
        u2[i] = ui + lu - uvv + feedAt[i] * (1 - ui);
        v2[i] = vi + 0.5 * lv + uvv - (feedAt[i] + killAt[i]) * vi;
      }
      [u, u2] = [u2, u];
      [v, v2] = [v2, v];
    }
  };
  /** The field as it stands, 0 to 1. */
  const field = () => {
    let max = 1e-6;
    for (let i = 0; i < size; i++) max = Math.max(max, v[i]);
    return Float32Array.from(v, (c) => c / max);
  };
  return { run, resize, field, grid: () => ({ nx, ny }) };
}

// The pattern dial is read along one run of growth, not grown anew at each setting: the field settles at the middle of
// the dial's low end, then the dial is turned slowly, the field growing all the while, and it is kept at every rung.
// So two settings near each other share their history and their land nearly agrees, and the dial moves the forms the
// way the chemistry moves them. A run goes only as far as has been asked for, and is kept while the page lasts.
const RUNG = 0.01, RUNG_STEPS = 92, SETTLE = 4000, KEPT_RUNS = 6;
const runs = new Map();
function rungsFor(key, make, sign, wanted) {
  const name = `${key}|${sign}`;
  const kept = runs.get(name) ?? { grower: make(), rungs: [] };
  runs.delete(name);
  runs.set(name, kept);
  if (runs.size > KEPT_RUNS * 2) runs.delete(runs.keys().next().value);
  if (!kept.rungs.length) (kept.grower.run(SETTLE, 0), kept.rungs.push(kept.grower.field()));
  while (kept.rungs.length <= wanted) (kept.grower.run(RUNG_STEPS, sign * kept.rungs.length * RUNG), kept.rungs.push(kept.grower.field()));
  return kept.rungs;
}

/** v, 0 to 1, on an nx × ny torus, where the run of growth for this grid, variety and seed stands at the pattern dial. */
export function grow({ nx, ny, pattern = 0.3, variety = 0, seed = 1 }) {
  const at = Math.abs(pattern) / RUNG, k = Math.floor(at), t = at - k;
  const rungs = rungsFor(`${nx}|${ny}|${variety}|${seed}`, () => growing({ nx, ny, variety, seed }), pattern < 0 ? -1 : 1, k + 1);
  const [a, b] = [rungs[k], rungs[k + 1]];
  return { nx, ny, v: a.map((c, i) => c + (b[i] - c) * t) };
}

/**
 * The field at each of `count` moments of one run from a start to an end, each { nx, ny, v }: the start as grow() has
 * it, then the same growth going on while the pattern dial and the grid turn toward the end's. Nothing is grown anew,
 * so each moment comes out of the last, and `grid` says the grid a setting's scale has.
 */
export function carried({ from, to, count, grid, steps = 200 }) {
  const start = grid(from), end = grid(to), g = growing({ ...start, variety: from.variety, seed: from.seed });
  g.run(SETTLE, 0);
  for (let k = 1, last = Math.round(Math.abs(from.pattern) / RUNG); k <= last; k++) g.run(RUNG_STEPS, Math.sign(from.pattern) * k * RUNG);
  const fields = [{ ...start, v: g.field() }];
  for (let k = 1; k < count; k++) {
    const t = k / (count - 1), nx = Math.round(start.nx + (end.nx - start.nx) * t), ny = Math.round(start.ny + (end.ny - start.ny) * t), { nx: was, ny: wasY } = g.grid();
    if (nx !== was || ny !== wasY) g.resize(nx, ny);
    g.run(steps, from.pattern + (to.pattern - from.pattern) * t);
    fields.push({ nx, ny, v: g.field() });
  }
  return fields;
}

/** v, 0 to 1, grown from its seeds with one pattern held, for a field no dial moves. */
export function settled({ nx, ny, pattern, variety = 0, steps, seed = 1 }) {
  const g = growing({ nx, ny, variety, seed });
  g.run(steps, pattern);
  return { nx, ny, v: g.field() };
}

/** The field at any point in cell units, smoothly, wrapping. */
export function sample({ nx, ny, v }, x, y) {
  x = ((x % nx) + nx) % nx;
  y = ((y % ny) + ny) % ny;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % nx, y1 = (y0 + 1) % ny;
  return (v[y0 * nx + x0] * (1 - fx) + v[y0 * nx + x1] * fx) * (1 - fy) + (v[y1 * nx + x0] * (1 - fx) + v[y1 * nx + x1] * fx) * fy;
}

/**
 * The islands the field makes above level t, gathered into k archipelagos by where they lie (k-means on their
 * middles, across the seams). Answers each cell's archipelago (-1 for sea) and each archipelago's island middles.
 */
export function archipelagos({ nx, ny, v }, t, k, seed = 1, starts = null, fixed = false) {
  const size = nx * ny, island = new Int32Array(size).fill(-1), middles = [];
  for (let start = 0; start < size; start++) {
    if (v[start] < t || island[start] >= 0) continue;
    // Flood one island; its middle is a mean of angles, so an island across a seam is not torn in two.
    const id = middles.length, stack = [start];
    let sx = 0, cx = 0, sy = 0, cy = 0, n = 0;
    island[start] = id;
    while (stack.length) {
      const i = stack.pop(), x = i % nx, y = (i - x) / nx;
      sx += Math.sin((2 * Math.PI * x) / nx), cx += Math.cos((2 * Math.PI * x) / nx), sy += Math.sin((2 * Math.PI * y) / ny), cy += Math.cos((2 * Math.PI * y) / ny), n++;
      for (const j of [y * nx + ((x + 1) % nx), y * nx + ((x - 1 + nx) % nx), ((y + 1) % ny) * nx + x, ((y - 1 + ny) % ny) * nx + x]) if (v[j] >= t && island[j] < 0) (island[j] = id), stack.push(j);
    }
    const ang = (s, c, m) => ((((Math.atan2(s, c) / (2 * Math.PI)) * m) % m) + m) % m;
    middles.push({ x: ang(sx, cx, nx), y: ang(sy, cy, ny), n });
  }
  // A labyrinth is one island, or a few: then the land itself is split by where it lies, a piece per archipelago.
  // Places fixed from outside split land the same way, so no island's joining another changes whose it is.
  const byIsland = !fixed && middles.length >= k;
  const points = byIsland ? middles : [];
  if (!byIsland) for (let i = 0; i < size; i += 3) if (island[i] >= 0) points.push({ x: i % nx, y: Math.floor(i / nx), n: 1 });
  const { of, centres, nearest } = byPlace(points, k, nx, ny, seed, starts);
  const group = new Int32Array(size).fill(-1);
  for (let i = 0; i < size; i++) if (island[i] >= 0) group[i] = byIsland ? of[island[i]] : nearest(i % nx, Math.floor(i / nx));
  // Each island's standing in its archipelago: the largest 1, the next smaller as sizes fall away (Zipf-like).
  const rank = new Float32Array(middles.length).fill(1), byGroup = new Map();
  middles.forEach((m, i) => {
    const g = group[Math.round(m.y) % ny * nx + (Math.round(m.x) % nx)];
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)).push(i);
  });
  for (const ids of byGroup.values()) ids.sort((a, b) => middles[b].n - middles[a].n).forEach((id, r) => (rank[id] = (r + 1) ** -0.6));
  return { group, island, rank, centres, members: centres.map((c, i) => (fixed ? [c] : points.filter((_, j) => of[j] === i))) };
}

/** k-means over points on the torus: k centres started far apart, biggest first, settled across the seams. */
function byPlace(points, k, nx, ny, seed, starts = null) {
  const gap = (a, b) => Math.hypot(Math.min(Math.abs(a.x - b.x), nx - Math.abs(a.x - b.x)), Math.min(Math.abs(a.y - b.y), ny - Math.abs(a.y - b.y)));
  if (!points.length) return { of: [], centres: (starts ?? []).map((c) => ({ ...c })), nearest: () => 0 };
  // Given centres (where the places are), each is kept where it is, in order: an island joins the nearest place.
  // On a map the page does not wrap, so distance to a place is measured straight.
  if (starts) return settle(points, starts.map((c) => ({ ...c })), nx, ny, 1, false, false);
  k = Math.max(1, Math.min(k, points.length));
  const rnd = random(seed * 31 + 3), centres = [{ ...points.reduce((a, b) => (b.n > a.n ? b : a)) }];
  const spread = (p) => Math.min(...centres.map((c) => gap(p, c)));
  while (centres.length < k) centres.push({ ...points.reduce((a, b) => (spread(b) * (0.7 + 0.6 * rnd()) > spread(a) ? b : a)) });
  return settle(points, centres, nx, ny, 10);
}

/** Lloyd's rounds over points on the torus: each point to its nearest centre, each centre to the middle of its points. */
function settle(points, centres, nx, ny, rounds, move = true, wraps = true) {
  const gap = wraps
    ? (a, b) => Math.hypot(Math.min(Math.abs(a.x - b.x), nx - Math.abs(a.x - b.x)), Math.min(Math.abs(a.y - b.y), ny - Math.abs(a.y - b.y)))
    : (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const closest = (p) => centres.map((c, i) => [gap(p, c), i]).sort((a, b) => a[0] - b[0])[0][1];
  const off = (a, b, m) => ((((a - b) % m) + 1.5 * m) % m) - m / 2;
  let of = points.map(() => 0);
  for (let round = 0; round < rounds; round++) {
    of = points.map(closest);
    if (!move) continue;
    centres.forEach((c, i) => {
      const mine = points.filter((_, j) => of[j] === i);
      if (!mine.length) return;
      c.x = (((c.x + mine.reduce((s, m) => s + off(m.x, c.x, nx), 0) / mine.length) % nx) + nx) % nx;
      c.y = (((c.y + mine.reduce((s, m) => s + off(m.y, c.y, ny), 0) / mine.length) % ny) + ny) % ny;
    });
  }
  return { of, centres, nearest: (x, y) => closest({ x, y }) };
}
