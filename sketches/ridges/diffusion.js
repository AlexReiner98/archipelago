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
 * v, 0 to 1, on an nx × ny torus. With variety, the pattern is not one setting but drifts across the page with a
 * slow noise: spots in one place, worms or coral in another, grown as one field.
 */
export function grow({ nx, ny, pattern = 0.3, variety = 0, steps = 4000, seed = 1 }) {
  const rnd = random(seed * 104729 + 7);
  const size = nx * ny;
  const drift = torusNoise(nx, ny, 3, random(seed * 7 + 11));
  const feedAt = new Float32Array(size), killAt = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = Math.max(0, Math.min(1, pattern + variety * 1.6 * (drift(i % nx, Math.floor(i / nx)) - 0.5)));
    ({ feed: feedAt[i], kill: killAt[i] } = rates(t));
  }
  let u = new Float32Array(size).fill(1), v = new Float32Array(size), u2 = new Float32Array(size), v2 = new Float32Array(size);
  // Seeds: small squares of the second chemical, enough that the field fills fast.
  for (let s = 0; s < 6 + Math.round(size / 300); s++) {
    const cx = Math.floor(rnd() * nx), cy = Math.floor(rnd() * ny), r = 1 + Math.floor(rnd() * 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = ((cy + dy + ny) % ny) * nx + ((cx + dx + nx) % nx);
      (u[i] = 0.5), (v[i] = 0.25 + rnd() * 0.1);
    }
  }
  // Each cell's eight neighbours, wrapped.
  const nb = new Int32Array(size * 8);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = (y * nx + x) * 8;
    [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy], k) => (nb[i + k] = ((y + dy + ny) % ny) * nx + ((x + dx + nx) % nx)));
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
  let max = 1e-6;
  for (let i = 0; i < size; i++) max = Math.max(max, v[i]);
  for (let i = 0; i < size; i++) v[i] /= max;
  return { nx, ny, v };
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
export function archipelagos({ nx, ny, v }, t, k, seed = 1, starts = null) {
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
  const byIsland = middles.length >= k;
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
  return { group, island, rank, centres, members: centres.map((_, i) => points.filter((_, j) => of[j] === i)) };
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
