// Stacked rows of terraced ridges. Islands rise where a slow noise field says land is, each built of softened
// stair-steps and banded in a run of palette colours; every row is drawn over the one behind it.
// Dials in, shapes out ({ fill, points } and { line, points }); no page.

import { grow, sample, archipelagos } from './diffusion.js';
import { clouds } from './clouds.js';

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
  relief: 0.6,     // height variety within an archipelago: even (0) to massifs among low islands (1)
  edges: 0.5,      // a calm border of open water round the islands: none (0) to wide (1)
  foothills: 0.6,  // smaller hills in front of each range, overlapping it: none (0) to many (1)
  peaks: 0.6,      // ranges in bands (0) to distinct summits, each row its own (1)
  undulate: 0.6,   // slope variety: each section of a climb a random check, up or level (0: always up at the max)
  shape: null,     // a seeding shape { nx, ny, v } over the page, 0 to 1 (a letter, rendered by the page)
  shapeStrength: 0.8, // how firmly land keeps to the shape: a hint (low) to the shape clearly read (1)
  clear: null,     // a clearing { nx, ny, v } over the page, 0 to 1 (round a name set there): land sinks, its coast wobbling
  clouds: 0,       // cloud cover: none (0) to overcast (1)
  cloudSize: 1,    // cloud banks small and many (low) to large and few (high)
  cloudPuff: 1,    // how high cloud tops billow at a cloud's heart, in rows
  cloudTip: 0.15,  // how high they billow at its thin ends, in rows: small tips (low) to blunt ends (high)
  cloudShadow: 0.5, // how dark the shadow a cloud casts on the water beneath it
  cloudPeaks: 0.8, // how much cloud is the mountains' own (caps, banners, wave clouds) against the spread (0 to 1)
  cloudSpread: 0.5, // how far the peaks' cloud spreads across the sky: only on the mountains (0) to all of it (1)
  wind: 0.6,       // wind strength: still air, caps only (0) to long banners and lee-wave clouds (2)
  windDir: 0,      // where the wind blows, in degrees: 0 right, 90 out of the page, 180 left, 270 into it
  slope: 2,        // max slope from the nearest water, height per unit across: steep (high) to gentle (low); 0 for none
  forms: null,     // (groups) => each archipelago's landform (see FORMS in palettes.js)
  anchors: null,   // [[x, y], ...] in page units: put archipelago i at anchor i (one per anchor), as on a map
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
  const gap = (H - 2 * M) / Math.max(1, d.rows);
  // Sizes are kept to the page's width, so a wider frame holds more islands, not larger ones.
  const across = W / DEFAULTS.width;
  const cells = (2 + d.islands * 10) * across;              // land field cells across the width
  const land = fbm(noise2(d.seed, d.wrap ? Math.round(cells) : 0), 3);
  const crest = fbm(noise2(d.seed + 1, d.wrap ? Math.round(cells * 3) : 0), 3);
  const puff = fbm(noise2(d.seed + 6, d.wrap ? Math.round(cells * 4) : 0), 2);
  const toCell = (x) => (x / W) * (d.wrap ? Math.round(cells) : cells);
  // Noise read at x on its own scale k: with repeat on, blended with its value a tile-width over, so whatever the
  // scale, the right edge comes back to exactly what the left edge has and the tile joins without a seam.
  const seam = (fn, x, k, off, b) => {
    const v = fn(toCell(x) * k + off, b);
    if (!d.wrap) return v;
    const t = x / W;
    return v * (1 - t) + fn(toCell(x - W) * k + off, b) * t;
  };
  const rise = d.rise * 16 * gap, step = Math.max(1, d.step * gap * 1.6), dx = 2;
  const xs = Array.from({ length: Math.floor((W - (d.wrap ? 0 : 2 * M)) / dx) + 1 }, (_, i) => (d.wrap ? 0 : M) + i * dx);
  const shapes = [], sky = [];

  // Island chains: each a gentle curve across the page that land gathers along. With none, land is wherever
  // the noise says, as one archipelago.
  // With anchors, chain n is centred on anchor n (an archipelago where its place is), and there is one per anchor.
  const chains = Array.from({ length: d.source.endsWith('chains') ? (d.anchors?.length ?? d.chains) : 0 }, (_, n) => {
    const at = d.anchors?.[n], cx = at ? at[0] : M + rnd() * (W - 2 * M), cy = at ? at[1] : M + rnd() * (H - 2 * M), a = rnd() * Math.PI, len = (0.35 + 0.4 * rnd()) * W, bend = (rnd() - 0.5) * 0.7 * len;
    const p0 = [cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2], p2 = [cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2], p1 = [cx - Math.sin(a) * bend, cy + Math.cos(a) * bend];
    const pts = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32;
      return [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
    });
    // Anchored chains are shorter, so each stays near its place and does not reach into its neighbours'.
    if (at) for (const p of pts) (p[0] = cx + (p[0] - cx) * 0.5), (p[1] = cy + (p[1] - cy) * 0.5);
    return { pts, width: (0.08 + 0.08 * rnd()) * W * (0.6 + d.land) * (at ? 0.8 : 1) };
  });
  /** Which chain claims a point most, how strongly (1 on its line, 0 a width away), and how far along it (0 to 1). */
  const claim = (x, y) => {
    let best = { c: 0, g: 0, t: 0, all: [] };
    chains.forEach(({ pts, width }, g) => {
      let near = Infinity, along = 0;
      pts.forEach(([px, py], i) => {
        let dx = Math.abs(x - px);
        if (d.wrap) dx = Math.min(dx, W - dx);
        const dd = dx * dx + (y - py) ** 2;
        if (dd < near) (near = dd), (along = i);
      });
      const c = 1 - smooth(0, width, Math.sqrt(near));
      best.all[g] = c;
      if (c > best.c) best = { ...best, c, g, t: along / (pts.length - 1) };
    });
    return best;
  };
  // Or reaction diffusion: land where the field is high, its islands gathered into archipelagos by where they lie.
  const rd = d.source.startsWith('diffusion') ? diffusionFor(d, W, H) : null;
  const cellOf = (x, y) => [(x / W) * rd.field.nx, (y / H) * rd.field.ny];
  // The field as read here: through a noise warp, with some of the noise field blended in.
  const field = (x, y, yc) => {
    const w = d.warp * 0.12 * DEFAULTS.width;
    const wx = x + (seam(land, x, 2, 7, yc * 2) - 0.5) * 2 * w, wy = y + (seam(land, x, 2, 0, yc * 2 + 7) - 0.5) * 2 * w;
    const n = Math.max(0, Math.min(1, (seam(land, x, 1, 0, yc) - 0.5) * 2.2 + 0.5));
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
  // Landforms blend where archipelagos meet, so one landmass shared by two changes character gradually, not at a
  // seam. On chains, each chain's form counts by how strongly it claims the point. On diffusion, each cell takes its
  // archipelago's form (the nearest's, at sea), and the values are blurred across the grid.
  const KEYS = Object.keys(BASE_FORM), numbers = new Map();
  const asNumbers = (g) => numbers.get(g) ?? numbers.set(g, KEYS.map((k) => +formOf(g)[k])).get(g);
  // The blurred grid is kept while the field, its archipelagos and their landforms hold: building it is the slow part.
  const formKey = rd && !chains.length ? `${grown.key}|${grown.akey}|${JSON.stringify(groups.map((_, g) => asNumbers(g)))}` : null;
  if (formKey && blurred.key !== formKey) blurred = { key: formKey, field: blurredForms(rd, asNumbers, KEYS.length) };
  const formField = formKey ? blurred.field : null;
  const formAt = (x, y, L) => {
    let v;
    if (formField) v = formField.map((field) => sample(field, ...cellOf(x, y)));
    else if (chains.length && L.all) {
      const w = L.all.map((c) => (c ?? 0) ** 4), total = w.reduce((a, b) => a + b, 0);
      v = total ? KEYS.map((_, k) => w.reduce((sum, wi, g) => sum + wi * asNumbers(g)[k], 0) / total) : asNumbers(L.g);
    } else v = asNumbers(L.g);
    return Object.fromEntries(KEYS.map((k, i) => [k, v[i]]));
  };

  /**
   * Land at a point: how far into land it is (u, against the band lo to hi, times gate), whose it is (g), how far
   * along its chain (t: the young end 0, the old 1), and how its island ranks among its neighbours (rank: largest 1).
   */
  const at = (x, y, yc) => {
    if (chains.length) {
      const { c, g, t, all } = claim(x, y);
      // The main island stands near the young end of a chain; the islands thin away toward the old end.
      const rank = Math.max(0.02, 1 - d.hierarchy * 0.75 * (1 - Math.exp(-(((t - 0.12) / 0.25) ** 2))));
      if (rd) {
        const lo = rd.level + d.hierarchy * 0.15 * (1 - rank);
        return { u: field(x, y, yc), lo, hi: lo + 0.12, gate: smooth(0.02, 0.35, c), g, t, rank, all };
      }
      const lo = 0.78 - d.land * 0.6;
      return { u: c * rank * (0.2 + 1.3 * seam(land, x, 2.5, 0, yc * 2.5)), lo, hi: lo + 0.14, gate: 1, g, t, rank, all };
    }
    if (rd) {
      // A smaller island in its archipelago is cut lower into the sea, so a few large islands lead many small ones.
      const { g, rank } = rdAt(x, y), lo = rd.level + d.hierarchy * 0.18 * (1 - rank);
      return { u: field(x, y, yc), lo, hi: lo + 0.12, gate: 1, g, t: 0, rank };
    }
    const lo = 1 - d.land - 0.05;
    return { u: seam(land, x, 1, 0, yc), lo, hi: lo + 0.17, gate: 1, g: 0, t: 0, rank: 1 };
  };

  // The border: land sinks into the sea toward the frame, along an edge that wobbles with noise so it never runs as
  // a line. At the frame itself nothing stands (shallows included). With repeat on, only top and bottom have one.
  const band = d.edges * 0.2 * Math.min(W - 2 * M, H - 2 * M);
  // up: how far what stands at this point rises above its row (a mountain, a cloud). The border keeps the same
  // water between the frame and what is drawn on both sides: at the bottom that is the row itself, at the top the
  // tops of what stands on it, so the top is measured from those (fully at the top edge, not at all at the bottom).
  const shore = (x, y, yc, up = 0) => {
    if (!band) return 1;
    const v = y - up * Math.max(0, Math.min(1, (H - M - y) / (H - 2 * M)));
    // How far in from the frame: to a rounded frame, so the border bends round each corner in an arc instead of
    // meeting there at a right angle (the sides' distances taken apart). With repeat on, top and bottom only.
    let e = Math.min(v - M, H - M - v);
    if (!d.wrap) {
      const hx = (W - 2 * M) / 2, hy = (H - 2 * M) / 2, round = Math.min(band * 1.6, hx, hy);
      const qx = Math.abs(x - W / 2) - hx + round, qy = Math.abs(v - H / 2) - hy + round;
      e = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round);
    }
    const wobble = (seam(land, x, 1.7, 21, yc * 1.7 + 9) - 0.5) * band * 1.3;
    return smooth(0.1, 1, (e + wobble) / band) * smooth(0, 0.3 * band, e);
  };

  // On a map, each place holds only so much sea: about the usual gap between places. Beyond it land sinks, so a
  // place far from the rest (the Arctic) does not claim half the page.
  const gaps = (d.anchors ?? []).map((a, i) => Math.min(...d.anchors.filter((_, j) => j !== i).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  const reach = gaps.length > 1 ? [...gaps].sort((a, b) => a - b)[gaps.length >> 1] * 1.35 : Infinity;
  const territory = (x, y) => {
    if (reach === Infinity) return 1;
    let near = Infinity;
    for (const [ax, ay] of d.anchors) near = Math.min(near, (x - ax) ** 2 + (y - ay) ** 2);
    return smooth(reach * 1.25, reach * 0.7, Math.sqrt(near));
  };

  // A land shape, marked small when its area is under about five rows squared: the species' accents go there.
  const small = gap * gap * 5;
  const put = (shape) => {
    let area = 0;
    shape.points.forEach(([x0, y0], n) => { const [x1, y1] = shape.points[(n + 1) % shape.points.length]; area += x0 * y1 - x1 * y0; });
    shapes.push({ ...shape, small: Math.abs(area) / 2 < small });
  };

  /** A grid over the whole page (the seeding shape, the clearing) at a point, 0 outside to 1 inside, smooth; not wrapping. */
  const gridAt = ({ nx, ny, v }, x, y) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x / W) * nx - 0.5)), fy = Math.max(0, Math.min(ny - 1.001, (y / H) * ny - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, at = (i, j) => v[j * nx + i];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };

  for (let r = 0; r < d.rows; r++) {
    const y = M + (r + 1) * gap, yc = (y / H) * cells * (H / W);
    const h = [], shelf = [], gs = [], ts = [], steps = [], raws = [], terraces = [];
    let seamStart = null;
    for (const x of xs) {
      const L = at(x, y, yc), f = formAt(x, y, L), span = L.hi - L.lo, age = chains.length ? d.age * L.t : 0;
      // Height: the place's own, lower for a lesser island and for an older one; with diffusion, rising to the heart.
      // Peaks: each row its own summits (the row index moves the noise faster), set apart from each other, so a
      // row's mountains stand clear of the row behind rather than lining up into bands.
      const c = seam(crest, x, 3 + 1.2 * d.peaks, 0, r * (0.12 + 0.55 * d.peaks));
      const rugged = Math.max(0, Math.min(2, d.rugged + f.rugged - age * 0.5));
      const peak = (rd ? 0.4 * c + 0.6 * smooth(rd.level, 1, L.u) : c) ** (1 + rugged * 2.5);
      // Height variety: a slow swell over the page lifts some islands into massifs and keeps others low.
      const massif = 1 + d.relief * (1.5 * seam(land, x, 0.6, 11, yc * 0.6 + 5) - 0.75) * 1.6;
      const tall = rise * f.rise * Math.max(0.15, massif) * Math.max(0.05, 1 - 0.8 * age) * Math.max(0.05, 1 - d.hierarchy * 0.6 * (1 - L.rank));
      let stands = tall * (0.25 - 0.2 * d.peaks + (0.75 + 0.2 * d.peaks) * peak ** (1 + 0.3 * d.peaks));
      if (f.top) stands = Math.min(stands, tall * (1 - 0.65 * f.top));
      // No peak rises past the top of the frame: heights near it are eased under the room left, not sliced off.
      if (band) {
        const room = Math.max(1, y - M - gap);
        stands = room * Math.tanh(stands / room);
      }
      // The border reckoned from part way up the land that would stand here (the coast's mask, the slope limit and
      // the terraces bring it lower than this), so a tall peak keeps about as clear of the top as the coast does of
      // the bottom.
      const calm = shore(x, y, yc, stands * 0.4) * territory(x, y);
      if (calm < 1) L.u -= (1 - calm) * 1.5;
      // A seeding shape (a letter): land rises inside it and sinks outside, so the archipelago takes its form.
      if (d.shape && d.shapeStrength > 0) {
        const g = gridAt(d.shape, x, y);
        L.u += d.shapeStrength * (g * (L.hi - L.lo) * 4 - (1 - g) * 1.5);
      }
      // A clearing: open water where a name is set, read from part way up what would stand here (as the border is),
      // its edge wobbling with noise so the islands part round the name rather than tracing its letters.
      if (d.clear) {
        const wobble = (seam(land, x, 1.7, 33, yc * 1.7 + 3) - 0.5) * 0.6;
        L.u -= smooth(0.1, 0.55, gridAt(d.clear, x, y - stands * 0.4) + wobble) * 1.5;
      }
      gs.push(L.g), ts.push(L.t), steps.push(Math.min(step * f.step, Math.max(1, rise * f.rise * 0.6)));
      // Shallows: a reach of pale sea round the land, wider as the dial turns.
      const sea = smooth(L.lo - span * (0.25 + 1.5 * d.shallows), L.lo, L.u) * L.gate * (d.shallows > 0 ? 1 : 0);
      shelf.push(sea);
      let mask = smooth(L.lo, L.hi, L.u) * L.gate;
      // An atoll, or an old island sinking at the far end of its chain: only a ring of land, its heart a lagoon.
      const sinking = Math.max(f.atoll, chains.length ? smooth(1 - d.age * 0.4, 1, L.t) * (d.age > 0 ? 1 : 0) : 0);
      if (sinking) mask *= 1 - sinking * smooth(L.hi + span * 0.6, L.hi + span * 1.4, L.u);
      // Sheer sides: the land reaches its full height almost at once.
      if (f.cliff) mask = smooth(0, 1 - 0.85 * f.cliff, mask);
      if (!mask) { raws.push(0), terraces.push([1, 0.3]); continue; }
      // The land as it stands where the mask lets it.
      const raw = mask * stands;
      // A coarse step never passes most of the land's own height, so even the coarsest leaves one terrace.
      const stp = Math.min(step * f.step, Math.max(1, tall * 0.6)), soft = Math.max(0.02, Math.min(1, d.soft + f.soft));
      raws.push(raw), terraces.push([stp, soft]);
    }
    // Max slope: no land rises faster than the slope from the nearest water in its row, so a narrow island stays low
    // and only a wide one can stand tall. Two sweeps, each carrying the limit in from a coast; then the terraces.
    if (d.slope > 0) {
      // Slope variety: the climb from each coast is a walk in sections of random length, and at each section a
      // random check decides whether it climbs (at a random share of the max slope, never more) or stays level. The
      // walks from the two coasts meet and the lower holds, so ramps alternate with benches and plateaus. With no
      // variety every section climbs at the max: the plain cap.
      const lim = d.slope * dx, v = Math.min(1, d.undulate), rr = random(d.seed * 7177 + r * 131);
      // The walk follows the land as it goes (never above it, so after a dip it climbs again from the dip, as the
      // plain cap does), and the first section off a coast always climbs, so no coast is eaten away.
      const walk = (order) => {
        let height = 0, left = 0, climb = lim, fresh = true;
        for (const i of order) {
          if (raws[i] <= 0) { (height = 0), (left = 0), (fresh = true); continue; }
          if (left-- <= 0) {
            left = 2 + Math.floor(rr() * (4 + 10 * d.undulate));
            climb = fresh || rr() < 1 - 0.6 * v ? lim * (1 - 0.7 * v * rr()) : 0;
            fresh = false;
          }
          raws[i] = height = Math.min(raws[i], height + climb);
        }
      };
      // With repeat on, each walk goes round the row twice, so the height it carries runs on across the seam.
      const idx = raws.map((_, i) => i), round = d.wrap ? [...idx, ...idx] : idx;
      walk(round);
      walk([...round].reverse());
      // The row's two ends are one place when it repeats: they must stand alike.
      if (d.wrap) raws[0] = raws[raws.length - 1] = Math.min(raws[0], raws[raws.length - 1]);
    }
    // A step is never more than most of its island's height as it now stands, so every island keeps a terrace.
    // With repeat on, an island across the seam is one island: its two ends share one height for this.
    const runs = [];
    for (let i = 0; i < raws.length; ) {
      if (raws[i] <= 0) { i++; continue; }
      let j = i, top = 0;
      while (j < raws.length && raws[j] > 0) top = Math.max(top, raws[j++]);
      runs.push([i, j, top]);
      i = j;
    }
    if (d.wrap && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === raws.length) runs[0][2] = runs[runs.length - 1][2] = Math.max(runs[0][2], runs[runs.length - 1][2]);
    for (const [i, j, top] of runs) for (let k = i; k < j; k++) terraces[k][0] = Math.min(terraces[k][0], Math.max(1, top * 0.6));
    raws.forEach((raw, i) => {
      const [stp, soft] = terraces[i], q = raw / stp, k = Math.floor(q);
      h.push(raw > 0 ? stp * (k + smooth(1 - soft, 1, q - k)) : 0);
    });
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
      const mid = (i + j) >> 1, group = gs[mid], stp = steps[mid];
      let start = Math.floor(rnd() * 1000), hills = 0;
      // With repeat on, an island's two halves either side of the seam take the same colours.
      if (d.wrap && i === 0) seamStart = start;
      if (d.wrap && j === xs.length && seamStart !== null) start = seamStart;
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
          // Each hill a band splits into takes its own colour, so a range breaks into smaller regions.
          if (pts.length >= 3) put({ fill: start + b * 13 + hills++ * 7, group, tone, points: [[pts[0][0], y], ...pts, [pts[pts.length - 1][0], y]] }), (any = true);
          k = e;
        }
        if (!any) break;
      }
      // Foothills: smaller hills standing in front of the range, overlapping it, so front shapes pass over back ones
      // and cut them into smaller regions. Terraced like the range; never taller than the land they stand on.
      const soft = Math.max(0.02, Math.min(1, d.soft + formAt(xs[mid], y, at(xs[mid], y, yc)).soft));
      const terrace = (raw) => { const q = raw / stp, n = Math.floor(q); return stp * (n + smooth(1 - soft, 1, q - n)); };
      const count = Math.round(d.foothills * ((j - i) * dx) / (gap * 7) + rnd() * d.foothills);
      for (let n = 0; n < count; n++) {
        const c = i + Math.floor(rnd() * (j - i)), half = Math.max(3, Math.round(((1.2 + 3 * rnd()) * gap) / dx));
        const top = h[c] * (0.3 + 0.4 * rnd());
        if (top < stp * 0.8) continue;
        const pts = [];
        for (let q = Math.max(i, c - half); q <= Math.min(j - 1, c + half); q++) {
          const t = (q - c) / half, lift = terrace(top * Math.max(0, 1 - t * t) ** 0.8);
          pts.push([xs[q], y - Math.min(lift, h[q])]);
        }
        if (pts.length >= 3) put({ foot: true, fill: start + 101 + n * 17, group, tone, points: [[pts[0][0], y], ...pts, [pts[pts.length - 1][0], y]] });
      }
      i = j;
    }
    // The row's floor: a line across the water.
    shapes.push({ line: true, points: [[xs[0], y], [xs[xs.length - 1], y]] });
    sky.push({ y, yc, h, at: shapes.length });
  }
  // Clouds, from the mountains and spread on the wind (clouds.js): each row's go in just after its land, so nearer land passes
  // in front of farther cloud. Last row first, so the earlier places stay where they were.
  const made = clouds({ d, rows: sky, xs, dx, gap, puff, seam, shore, smooth });
  for (let r = sky.length - 1; r >= 0; r--) shapes.splice(sky[r].at, 0, ...made[r]);
  return { width: W, height: H, shapes, line: d.line, chains: groups };
}

/** The field and its archipelagos for these dials, grown once and kept while the dials that shape it hold. */
let grown = {};
function diffusionFor(d, W, H) {
  const nx = Math.max(16, Math.round((40 + d.scale * 70) * (W / DEFAULTS.width))), ny = Math.round((nx * H) / W), level = 0.62 - d.land * 0.5;
  const key = `${nx}|${ny}|${d.pattern}|${d.variety}|${d.seed}`;
  if (grown.key !== key) grown = { key, field: grow({ nx, ny, pattern: d.pattern, variety: d.variety, seed: d.seed }) };
  // Anchors (page units) start the grouping where the places are, so each archipelago gathers the islands near it.
  const starts = d.anchors?.map(([x, y]) => ({ x: (x / W) * nx, y: (y / H) * ny }));
  const akey = `${level}|${d.chains}|${JSON.stringify(starts)}`;
  if (grown.akey !== akey) Object.assign(grown, { akey, arch: archipelagos(grown.field, level, starts?.length ?? Math.max(1, d.chains), d.seed, starts) });
  return { field: grown.field, arch: grown.arch, level };
}

let blurred = {};

/** Each landform value laid on the diffusion grid by archipelago (the nearest, at sea), then box-blurred, wrapping. */
function blurredForms(rd, asNumbers, n) {
  const { nx, ny } = rd.field, size = nx * ny;
  const far = (x, y, c) => Math.hypot(Math.min(Math.abs(x - c.x), nx - Math.abs(x - c.x)), Math.min(Math.abs(y - c.y), ny - Math.abs(y - c.y)));
  const groupAt = new Int32Array(size);
  for (let i = 0; i < size; i++) {
    const g = rd.arch.group[i], x = i % nx, y = (i - x) / nx;
    groupAt[i] = g >= 0 ? g : rd.arch.centres.map((c, k) => [far(x, y, c), k]).sort((a, b) => a[0] - b[0])[0]?.[1] ?? 0;
  }
  const values = new Map();
  const fields = Array.from({ length: n }, (_, k) => Float32Array.from(groupAt, (g) => (values.get(g) ?? values.set(g, asNumbers(g)).get(g))[k]));
  const r = Math.max(2, Math.round(nx / 18));
  for (const v of fields) for (let pass = 0; pass < 3; pass++) {
    const t = new Float32Array(size);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += v[y * nx + ((x + d + nx) % nx)];
      t[y * nx + x] = s / (2 * r + 1);
    }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += t[((y + d + ny) % ny) * nx + x];
      v[y * nx + x] = s / (2 * r + 1);
    }
  }
  return fields.map((v) => ({ nx, ny, v }));
}
