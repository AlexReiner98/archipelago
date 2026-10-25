// Stacked rows of terraced ridges. Islands rise where a slow noise field says land is, each built of softened
// stair-steps and banded in a run of palette colours; every row is drawn over the one behind it.
// Dials in, shapes out ({ fill, points } and { line, points }); no page.

import { grow, sample, archipelagos } from './diffusion.js';

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
  source: 'chains', // where land is: 'noise' (one field), 'chains' (curves), 'diffusion' (reaction-diffusion)
  chains: 4,       // archipelagos on the page: chains to draw, or groups of diffusion islands
  pattern: 0.3,    // diffusion: dividing spots (0), worms (0.5), coral labyrinth (1)
  scale: 0.4,      // diffusion: large forms (0) to fine (1)
  line: 1.2,       // outline weight
  seed: 1,
  wrap: false,     // repeat seamlessly left to right
};

/**
 * The picture: { width, height, shapes } with shapes in draw order. A shape's colour is a number (fill) to pick from
 * a palette with, and the chain it belongs to (group), whose archipelago's palette it is coloured from.
 */
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

  // Island chains: each a gentle curve across the page that land gathers along. With none, land is wherever
  // the noise says, as one archipelago.
  const chains = Array.from({ length: d.source === 'chains' ? d.chains : 0 }, () => {
    const cx = M + rnd() * (W - 2 * M), cy = M + rnd() * (H - 2 * M), a = rnd() * Math.PI, len = (0.35 + 0.4 * rnd()) * W, bend = (rnd() - 0.5) * 0.7 * len;
    const p0 = [cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2], p2 = [cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2], p1 = [cx - Math.sin(a) * bend, cy + Math.cos(a) * bend];
    const pts = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    });
    return { pts, width: (0.08 + 0.08 * rnd()) * W * (0.6 + d.land) };
  });
  /** How strongly each chain claims a point: 1 on its line, 0 a width away. */
  const pull = (x, y) =>
    chains.map(({ pts, width }) => {
      let best = Infinity;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px);
        if (d.wrap) dx = Math.min(dx, W - dx);
        best = Math.min(best, dx * dx + (y - py) ** 2);
      }
      return 1 - smooth(0, width, Math.sqrt(best));
    });
  // Or reaction diffusion: land where the field is high, its islands gathered into archipelagos by where they lie.
  const rd = d.source === 'diffusion' ? diffusionFor(d, W, H) : null;
  const cellOf = (x, y) => [(x / W) * rd.field.nx, (y / H) * rd.field.ny];
  const nearest = (x, y) => {
    if (rd) {
      const [cx, cy] = cellOf(x, y), g = rd.arch.group[Math.floor(cy) * rd.field.nx + Math.floor(cx)];
      if (g >= 0) return g;
      const { nx, ny } = rd.field, far = (c) => Math.hypot(Math.min(Math.abs(cx - c.x), nx - Math.abs(cx - c.x)), Math.min(Math.abs(cy - c.y), ny - Math.abs(cy - c.y)));
      return rd.arch.centres.map((c, i) => [far(c), i]).sort((a, b) => a[0] - b[0])[0]?.[1] ?? 0;
    }
    if (!chains.length) return 0;
    const p = pull(x, y);
    return p.indexOf(Math.max(...p));
  };

  for (let r = 0; r < d.rows; r++) {
    const y = M + (r + 1) * gap, yc = (y / H) * cells * (H / W);
    // Height along the row: land decides where, crest how high, terraced into softened steps.
    const h = xs.map((x) => {
      // Along a chain, finer noise breaks the land into separate islands, strung along its line.
      const v = rd ? sample(rd.field, ...cellOf(x, y)) : 0;
      const mask = rd
        ? smooth(rd.level, rd.level + 0.12, v)
        : chains.length
          ? smooth(0.78 - d.land * 0.6, 0.92 - d.land * 0.6, Math.max(...pull(x, y)) * (0.2 + 1.3 * land(toCell(x) * 2.5, yc * 2.5)))
          : smooth(1 - d.land - 0.05, 1 - d.land + 0.12, land(toCell(x), yc));
      if (!mask) return 0;
      // With diffusion the field shapes the heights too: an island rises toward its heart.
      const c = crest(toCell(x) * 3, r * 0.12);
      const peak = (rd ? 0.4 * c + 0.6 * smooth(rd.level, 1, v) : c) ** (1 + d.rugged * 2.5);
      const raw = mask * rise * (0.25 + 0.75 * peak);
      const q = raw / step, k = Math.floor(q);
      return step * (k + smooth(1 - d.soft, 1, q - k));
    });
    // Each island: a run of x where the row rises. Its bands are the same profile, lowered step by step.
    for (let i = 0; i < xs.length; ) {
      if (h[i] < 0.5) { i++; continue; }
      let j = i;
      while (j < xs.length && h[j] >= 0.5) j++;
      const start = Math.floor(rnd() * 1000), group = nearest(xs[(i + j) >> 1], y);
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
          // Down to the floor at both ends, even where the page edge cuts the island off mid-slope.
          if (pts.length >= 3) shapes.push({ fill: start + b, group, points: [[pts[0][0], y], ...pts, [pts[pts.length - 1][0], y]] }), (any = true);
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
      shapes.push({ fill: Math.floor(rnd() * 1000), group: nearest((a + b) / 2, y), points: [[a, y - gap * 0.45], [Math.min(b, xs[xs.length - 1]), y - gap * 0.45], [Math.min(b, xs[xs.length - 1]), y], [a, y]] });
    }
  }
  // Where each archipelago lies, for the page to give neighbours contrasting palettes.
  const groups = rd
    ? rd.arch.members.map((ms, i) => (ms.length ? ms : [rd.arch.centres[i]]).map((m) => [(m.x / rd.field.nx) * W, (m.y / rd.field.ny) * H]))
    : chains.map((c) => c.pts);
  return { width: W, height: H, shapes, line: d.line, chains: groups };
}

/** The field and its archipelagos for these dials, grown once and kept while the dials that shape it hold. */
let grown = {};
function diffusionFor(d, W, H) {
  const nx = Math.round(40 + d.scale * 70), ny = Math.round((nx * H) / W), level = 0.62 - d.land * 0.5;
  const key = `${nx}|${ny}|${d.pattern}|${d.seed}`;
  if (grown.key !== key) grown = { key, field: grow({ nx, ny, pattern: d.pattern, seed: d.seed }) };
  const akey = `${level}|${d.chains}`;
  if (grown.akey !== akey) Object.assign(grown, { akey, arch: archipelagos(grown.field, level, Math.max(1, d.chains), d.seed) });
  return { field: grown.field, arch: grown.arch, level };
}
