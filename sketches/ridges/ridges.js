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

/** A landform that changes nothing: the dials as they are. */
const BASE_FORM = { rise: 1, rugged: 0, step: 1, soft: 0, top: 0, cliff: 0, atoll: false };

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
  source: 'chains', // where land is: 'noise' (one field), 'chains' (curves), 'diffusion' (reaction-diffusion),
                   // 'diffusion-chains' (diffusion islands only along the chains)
  chains: 4,       // archipelagos on the page: chains to draw, or groups of diffusion islands
  pattern: 0.3,    // diffusion: dividing spots (0), worms (0.5), coral labyrinth (1)
  scale: 0.4,      // diffusion: large forms (0) to fine (1)
  variety: 0.3,    // diffusion: one pattern everywhere (0) to spots, worms and coral side by side (1)
  warp: 0.3,       // diffusion: read through noise, so its even spacing goes irregular
  mix: 0.2,        // diffusion: how much of the old noise field is blended in
  hierarchy: 0.6,  // islands all alike (0) to a few large leading many small (1)
  age: 0.6,        // along a chain, young tall dark islands (one end) to old low sinking atolls (the other)
  shallows: 0.4,   // how wide the pale shallow water round the land reaches
  forms: null,     // (groups) => each archipelago's landform (see FORMS in palettes.js)
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
  const chains = Array.from({ length: d.source.endsWith('chains') ? d.chains : 0 }, () => {
    const cx = M + rnd() * (W - 2 * M), cy = M + rnd() * (H - 2 * M), a = rnd() * Math.PI, len = (0.35 + 0.4 * rnd()) * W, bend = (rnd() - 0.5) * 0.7 * len;
    const p0 = [cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2], p2 = [cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2], p1 = [cx - Math.sin(a) * bend, cy + Math.cos(a) * bend];
    const pts = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    });
    return { pts, width: (0.08 + 0.08 * rnd()) * W * (0.6 + d.land) };
  });
  /** Which chain claims a point most, how strongly (1 on its line, 0 a width away), and how far along it (0 to 1). */
  const claim = (x, y) => {
    let best = { c: 0, g: 0, t: 0 };
    chains.forEach(({ pts, width }, g) => {
      let near = Infinity, along = 0;
      pts.forEach(([px, py], i) => {
        let dx = Math.abs(x - px);
        if (d.wrap) dx = Math.min(dx, W - dx);
        const dd = dx * dx + (y - py) ** 2;
        if (dd < near) (near = dd), (along = i);
      });
      const c = 1 - smooth(0, width, Math.sqrt(near));
      if (c > best.c) best = { c, g, t: along / (pts.length - 1) };
    });
    return best;
  };
  // Or reaction diffusion: land where the field is high, its islands gathered into archipelagos by where they lie.
  const rd = d.source.startsWith('diffusion') ? diffusionFor(d, W, H) : null;
  const cellOf = (x, y) => [(x / W) * rd.field.nx, (y / H) * rd.field.ny];
  // The field as read here: through a noise warp, with some of the noise field blended in.
  const field = (x, y, yc) => {
    const w = d.warp * 0.12 * W;
    const wx = x + (land(toCell(x) * 2 + 7, yc * 2) - 0.5) * 2 * w, wy = y + (land(toCell(x) * 2, yc * 2 + 7) - 0.5) * 2 * w;
    const n = Math.max(0, Math.min(1, (land(toCell(x), yc) - 0.5) * 2.2 + 0.5));
    return (1 - d.mix) * sample(rd.field, ...cellOf(wx, wy)) + d.mix * n;
  };
  /** The diffusion archipelago a point is in (or the nearest), and the rank of the island it stands on. */
  const rdAt = (x, y) => {
    const { nx, ny } = rd.field, [cx, cy] = cellOf(x, y);
    const i = (((Math.floor(cy) % ny) + ny) % ny) * nx + (((Math.floor(cx) % nx) + nx) % nx);
    const isl = rd.arch.island[i], rank = isl >= 0 ? rd.arch.rank[isl] : 1, g = rd.arch.group[i];
    if (g >= 0) return { g, rank };
    const far = (c) => Math.hypot(Math.min(Math.abs(cx - c.x), nx - Math.abs(cx - c.x)), Math.min(Math.abs(cy - c.y), ny - Math.abs(cy - c.y)));
    return { g: rd.arch.centres.map((c, k) => [far(c), k]).sort((a, b) => a[0] - b[0])[0]?.[1] ?? 0, rank };
  };

  // Where each archipelago lies, for the page to give neighbours contrasting palettes; and so how its land stands.
  const groups = rd && !chains.length
    ? rd.arch.members.map((ms, i) => (ms.length ? ms : [rd.arch.centres[i]]).map((m) => [(m.x / rd.field.nx) * W, (m.y / rd.field.ny) * H]))
    : chains.map((c) => c.pts);
  const forms = d.forms ? d.forms(groups) : [];
  const formOf = (g) => ({ ...BASE_FORM, ...(forms[g] ?? forms[0] ?? {}) });

  /**
   * Land at a point: how far into land it is (u, against the band lo to hi, times gate), whose it is (g), how far
   * along its chain (t: the young end 0, the old 1), and how its island ranks among its neighbours (rank: largest 1).
   */
  const at = (x, y, yc) => {
    if (chains.length) {
      const { c, g, t } = claim(x, y);
      // The main island stands near the young end of a chain; the islands thin away toward the old end.
      const rank = 1 - d.hierarchy * 0.75 * (1 - Math.exp(-(((t - 0.12) / 0.25) ** 2)));
      if (rd) {
        const lo = rd.level + d.hierarchy * 0.15 * (1 - rank);
        return { u: field(x, y, yc), lo, hi: lo + 0.12, gate: smooth(0.02, 0.35, c), g, t, rank };
      }
      const lo = 0.78 - d.land * 0.6;
      return { u: c * rank * (0.2 + 1.3 * land(toCell(x) * 2.5, yc * 2.5)), lo, hi: lo + 0.14, gate: 1, g, t, rank };
    }
    if (rd) {
      // A smaller island in its archipelago is cut lower into the sea, so a few large islands lead many small ones.
      const { g, rank } = rdAt(x, y), lo = rd.level + d.hierarchy * 0.18 * (1 - rank);
      return { u: field(x, y, yc), lo, hi: lo + 0.12, gate: 1, g, t: 0, rank };
    }
    const lo = 1 - d.land - 0.05;
    return { u: land(toCell(x), yc), lo, hi: lo + 0.17, gate: 1, g: 0, t: 0, rank: 1 };
  };

  for (let r = 0; r < d.rows; r++) {
    const y = M + (r + 1) * gap, yc = (y / H) * cells * (H / W);
    const h = [], shelf = [], gs = [], ts = [];
    for (const x of xs) {
      const L = at(x, y, yc), f = formOf(L.g), span = L.hi - L.lo, age = chains.length ? d.age * L.t : 0;
      gs.push(L.g), ts.push(L.t);
      // Shallows: a reach of pale sea round the land, wider as the dial turns.
      const sea = smooth(L.lo - span * (0.25 + 1.5 * d.shallows), L.lo, L.u) * L.gate * (d.shallows > 0 ? 1 : 0);
      shelf.push(sea);
      let mask = smooth(L.lo, L.hi, L.u) * L.gate;
      // An atoll, or an old island sinking at the far end of its chain: only a ring of land, its heart a lagoon.
      const sinking = Math.max(f.atoll ? 1 : 0, chains.length ? smooth(1 - d.age * 0.4, 1, L.t) * (d.age > 0 ? 1 : 0) : 0);
      if (sinking) mask *= 1 - sinking * smooth(L.hi + span * 0.6, L.hi + span * 1.4, L.u);
      // Sheer sides: the land reaches its full height almost at once.
      if (f.cliff) mask = smooth(0, 1 - 0.85 * f.cliff, mask);
      if (!mask) { h.push(0); continue; }
      // Height: the place's own, lower for a lesser island and for an older one; with diffusion, rising to the heart.
      const c = crest(toCell(x) * 3, r * 0.12);
      const rugged = Math.max(0, Math.min(1, d.rugged + f.rugged - age * 0.5));
      const peak = (rd ? 0.4 * c + 0.6 * smooth(rd.level, 1, L.u) : c) ** (1 + rugged * 2.5);
      const tall = rise * f.rise * (1 - 0.8 * age) * (1 - d.hierarchy * 0.6 * (1 - L.rank));
      let raw = mask * tall * (0.25 + 0.75 * peak);
      if (f.top) raw = Math.min(raw, tall * (1 - 0.65 * f.top));
      const stp = step * f.step, soft = Math.max(0.02, Math.min(1, d.soft + f.soft));
      const q = raw / stp, k = Math.floor(q);
      h.push(stp * (k + smooth(1 - soft, 1, q - k)));
    }
    // The shallows first, so the land stands in them: three depths, offshore to the coast (sea 0, 1, 2), each
    // narrower than the last, all one gently rising profile.
    [0.02, 0.4, 0.75].forEach((from, depth) => {
      for (let i = 0; i < xs.length; ) {
        if (shelf[i] <= from) { i++; continue; }
        let j = i;
        while (j < xs.length && shelf[j] > from) j++;
        const pts = [];
        for (let q = Math.max(0, i - 1); q <= Math.min(xs.length - 1, j); q++) pts.push([xs[q], y - (q >= i && q < j ? gap * (0.2 + 0.3 * shelf[q]) : 0)]);
        shapes.push({ sea: depth, group: gs[(i + j) >> 1], points: [[pts[0][0], y], ...pts, [pts[pts.length - 1][0], y]] });
        i = j;
      }
    });
    // Each island: a run of x where the row rises. Its bands are the same profile, lowered step by step.
    for (let i = 0; i < xs.length; ) {
      if (h[i] < 0.5) { i++; continue; }
      let j = i;
      while (j < xs.length && h[j] >= 0.5) j++;
      const mid = (i + j) >> 1, group = gs[mid], start = Math.floor(rnd() * 1000), stp = step * formOf(group).step;
      // Along an aged chain, colour follows age: the young end in the palette's dark colours, the old in its light.
      const tone = chains.length && d.age > 0 ? 0.1 + 0.8 * ts[mid] : null;
      for (let b = 0; b < d.bands; b++) {
        const lift = b * stp;
        let any = false;
        // A lowered band may split into several hills: each is its own shape.
        for (let k = i; k < j; ) {
          if (h[k] - lift < 0.3) { k++; continue; }
          let e = k;
          while (e < j && h[e] - lift >= 0.3) e++;
          const pts = [];
          for (let q = Math.max(0, k - 1); q <= Math.min(xs.length - 1, e); q++) pts.push([xs[q], y - Math.max(0, h[q] - lift)]);
          // Down to the floor at both ends, even where the page edge cuts the island off mid-slope.
          if (pts.length >= 3) shapes.push({ fill: start + b, group, tone, points: [[pts[0][0], y], ...pts, [pts[pts.length - 1][0], y]] }), (any = true);
          k = e;
        }
        if (!any) break;
      }
      i = j;
    }
    // The row's floor: a line across the water.
    shapes.push({ line: true, points: [[xs[0], y], [xs[xs.length - 1], y]] });
  }
  return { width: W, height: H, shapes, line: d.line, chains: groups };
}

/** The field and its archipelagos for these dials, grown once and kept while the dials that shape it hold. */
let grown = {};
function diffusionFor(d, W, H) {
  const nx = Math.round(40 + d.scale * 70), ny = Math.round((nx * H) / W), level = 0.62 - d.land * 0.5;
  const key = `${nx}|${ny}|${d.pattern}|${d.variety}|${d.seed}`;
  if (grown.key !== key) grown = { key, field: grow({ nx, ny, pattern: d.pattern, variety: d.variety, seed: d.seed }) };
  const akey = `${level}|${d.chains}`;
  if (grown.akey !== akey) Object.assign(grown, { akey, arch: archipelagos(grown.field, level, Math.max(1, d.chains), d.seed) });
  return { field: grown.field, arch: grown.arch, level };
}
