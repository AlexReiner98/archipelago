// Stacked rows of terraced ridges. Islands rise where a slow noise field says land is, each built of softened
// stair-steps and banded in a run of palette colours; every row is drawn over the one behind it.
// Dials in, shapes out ({ fill, points } and { line, points }); no page.

export const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Smooth value noise in two dimensions, repeating every `period` cells in x (0 for never). */
function noise2(seed, period = 0) {
  const hash = (x, y) => {
    if (period) x = ((x % period) + period) % period;
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}
/** A few octaves of noise, 0 to 1. */
const fbm = (n, octaves) => (x, y) => {
  let v = 0, amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) (v += amp * n(x * 2 ** o, y * 2 ** o)), (total += amp), (amp /= 2);
  return v / total;
};
const smooth = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export const DEFAULTS = {
  width: 800, height: 1000, margin: 60,
  rows: 90,        // how many rows
  land: 0.5,       // how much of the field is island
  islands: 0.5,    // island size: few and large to many and small
  rise: 0.5,       // how tall ridges rise, in rows
  rugged: 0.5,     // smooth hills to jagged peaks
  step: 0.9,       // terrace height, as a share of a row
  soft: 0.3,       // how rounded each stair-step is
  bands: 3,        // colour bands nested in each island
  bars: 0.15,      // how often a row's floor is a bar of colour
  line: 1.2,       // outline weight
  seed: 1,
  wrap: false,     // repeat seamlessly left to right
};

/** The picture: { width, height, shapes } with shapes in draw order. A shape's colour is an index into the palette's colours. */
export function ridges(dials) {
  const d = { ...DEFAULTS, ...dials }, rnd = random(d.seed * 7919);
  const { width: W, height: H, margin: M } = d;
  const gap = (H - 2 * M) / d.rows;
  const cells = 2 + d.islands * 10;                         // land field cells across the width
  const land = fbm(noise2(d.seed, d.wrap ? Math.round(cells) : 0), 3);
  const crest = fbm(noise2(d.seed + 1, d.wrap ? Math.round(cells * 3) : 0), 3);
  const toCell = (x) => (x / W) * (d.wrap ? Math.round(cells) : cells);
  const rise = d.rise * 16 * gap, step = Math.max(1, d.step * gap * 1.6), dx = 2;
  const xs = Array.from({ length: Math.floor((W - (d.wrap ? 0 : 2 * M)) / dx) + 1 }, (_, i) => (d.wrap ? 0 : M) + i * dx);
  const shapes = [];

  for (let r = 0; r < d.rows; r++) {
    const y = M + (r + 1) * gap, yc = (y / H) * cells * (H / W);
    // Height along the row: land decides where, crest how high, terraced into softened steps.
    const h = xs.map((x) => {
      const mask = smooth(1 - d.land - 0.05, 1 - d.land + 0.12, land(toCell(x), yc));
      if (!mask) return 0;
      const peak = crest(toCell(x) * 3, r * 0.12) ** (1 + d.rugged * 2.5);
      const raw = mask * rise * (0.25 + 0.75 * peak);
      const q = raw / step, k = Math.floor(q);
      return step * (k + smooth(1 - d.soft, 1, q - k));
    });
    // Each island: a run of x where the row rises. Its bands are the same profile, lowered step by step.
    for (let i = 0; i < xs.length; ) {
      if (h[i] < 0.5) { i++; continue; }
      let j = i;
      while (j < xs.length && h[j] >= 0.5) j++;
      const start = Math.floor(rnd() * 1000);
      for (let b = 0; b < d.bands; b++) {
        const lift = b * step;
        let any = false;
        // A lowered band may split into several hills: each is its own shape.
        for (let k = i; k < j; ) {
          if (h[k] - lift < 0.3) { k++; continue; }
          let e = k;
          while (e < j && h[e] - lift >= 0.3) e++;
          const pts = [];
          for (let q = Math.max(0, k - 1); q <= Math.min(xs.length - 1, e); q++) pts.push([xs[q], y - Math.max(0, h[q] - lift)]);
          if (pts.length >= 3) shapes.push({ fill: start + b, points: [...pts, [pts[pts.length - 1][0], y]] }), (any = true);
          k = e;
        }
        if (!any) break;
      }
      i = j;
    }
    // The row's floor: a line, now and then a bar of colour.
    shapes.push({ line: true, points: [[xs[0], y], [xs[xs.length - 1], y]] });
    if (rnd() < d.bars) {
      const a = xs[0] + rnd() * (xs[xs.length - 1] - xs[0]) * 0.8, b = a + (0.05 + rnd() * 0.3) * W;
      shapes.push({ fill: Math.floor(rnd() * 1000), points: [[a, y - gap * 0.45], [Math.min(b, xs[xs.length - 1]), y - gap * 0.45], [Math.min(b, xs[xs.length - 1]), y], [a, y]] });
    }
  }
  return { width: W, height: H, shapes, line: d.line };
}
