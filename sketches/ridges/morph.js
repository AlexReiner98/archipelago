// A ridges picture that moves: from one saved setup to another, written as one animated SVG, light enough to keep as a
// figure on the site. Both pictures are in it, shape for shape, as ridges() draws them. Land rises from its row's
// floor and sinks back to it, a run of shapes at a time, starting where a field running from the one setup to the
// other says land comes first. Before the end's land rises it has no height at all, and after the start's sinks
// neither has it, so the first moment is the start and the last the end, and nothing else ever shows.
// Dials in, an SVG out; no page.

import { archipelagos, grow, growing, sample } from './diffusion.js';
import { DEFAULTS, ridges } from './ridges.js';

export const MORPH = {
  start: 'Hero Start', // the setup it starts from
  end: 'Hero End',     // the setup it ends on
  seconds: 8,     // how long it takes
  wait: 1,        // how long the start holds first
  rise: 1.6,      // how long one run of land takes to rise
  keys: 10,       // moments of the field it reads where land comes first
  grow: 1800,     // how far the field grows between two of them
  steps: 8,       // moments land may start rising: more is smoother, and heavier
  detail: 0.1,    // how far a shape's outline may stray, in units of the page: more is lighter
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** The grid a setup grows its field on, as the still picture has it. */
const gridOf = ({ scale, width: W, height: H }) => {
  const nx = Math.max(16, Math.round((40 + scale * 70) * (W / DEFAULTS.width)));
  return { nx, ny: Math.round((nx * H) / W) };
};

/**
 * The field at each key moment. It starts as the start setup grows it and runs on with the dials turning toward the
 * end's, so islands really grow and join, drawing into the field the end setup grows, which it is at the last key.
 * A finer scale is the chemicals spreading slower. The places are the end's, and fixed for the whole run, each cell
 * in the place nearest it, so no island changes palette as it joins another.
 */
export function fieldsOf({ from, to, morph: m }) {
  const { nx, ny } = gridOf(from), far = gridOf(to);
  const grown = grow({ ...far, pattern: to.pattern, variety: to.variety, seed: to.seed });
  const end = Float32Array.from({ length: nx * ny }, (_, i) => sample(grown, ((i % nx) * far.nx) / nx, (Math.floor(i / nx) * far.ny) / ny));
  const diffuse = (scale) => Math.min(1, (gridOf(from).nx / gridOf({ ...from, scale }).nx) ** 2);
  const grower = growing({ nx, ny, variety: from.variety, seed: from.seed });
  grower.run(4000, from.pattern);
  const fields = [grower.field()], parts = 4;
  for (let k = 1; k < m.keys; k++) {
    for (let p = 1; p <= parts; p++) {
      const t = ease((k - 1 + p / parts) / (m.keys - 1));
      grower.run(Math.round(m.grow / parts), lerp(from.pattern, to.pattern, t), diffuse(lerp(from.scale, to.scale, t)));
    }
    const on = ease(k / (m.keys - 1)) ** 2, { v } = grower.field();
    fields.push({ nx, ny, v: v.map((c, i) => lerp(c, end[i], on)) });
  }
  const found = archipelagos(fields.at(-1), 0.62 - to.land * 0.5, Math.max(1, to.chains), to.seed);
  const gap = (x, y, c) => Math.hypot(Math.min(Math.abs(x - c.x), nx - Math.abs(x - c.x)), Math.min(Math.abs(y - c.y), ny - Math.abs(y - c.y)));
  const group = Int32Array.from({ length: nx * ny }, (_, i) => {
    const x = i % nx, y = (i - x) / nx;
    return found.centres.reduce((best, c, g) => (gap(x, y, c) < gap(x, y, found.centres[best]) ? g : best), 0);
  });
  return { fields, arch: { ...found, group, island: new Int32Array(nx * ny).fill(-1), rank: new Float32Array(1).fill(1) } };
}

/** Every dial that is a number, part way from one setup to the other. */
const between = (from, to, t) => Object.fromEntries(Object.entries(from).map(([k, v]) => [k, typeof v === 'number' && typeof to[k] === 'number' ? lerp(v, to[k], t) : v]));

/** Each row at each key, as ridges() has the land there, read for where land comes first. */
export function keysOf({ from, to, morph: m }) {
  const { fields, arch } = fieldsOf({ from, to, morph: m });
  const key = `morph ${Math.random()}`;
  return fields.map((field, k) => ridges({ ...between(from, to, ease(k / (m.keys - 1))), source: 'diffusion', foothills: 0, clouds: 0, hierarchy: 0, seed: from.seed, pinned: { key, field, arch } }));
}

/** The points of a line that stand more than tol off the straight line between those kept. */
function fewer(p, tol) {
  if (p.length < 3) return p;
  const keep = [p[0]];
  const walk = (a, b) => {
    const [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let far = -1, at = 0;
    for (let i = a + 1; i < b; i++) {
      const off = len ? Math.abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / len : Math.hypot(p[i][0] - x1, p[i][1] - y1);
      if (off > far) (far = off), (at = i);
    }
    if (far > tol) walk(a, at), keep.push(p[at]), walk(at, b);
  };
  walk(0, p.length - 1);
  keep.push(p.at(-1));
  return keep;
}

/** A shape's outline in eighths of a unit of the page, measured from its row's floor, which is drawn exactly. */
function written(points, tol, floor, closed) {
  let d = '', px = 0, py = 0;
  fewer(points, tol).forEach(([x, y], i) => {
    const X = Math.round(x * UNITS), Y = Math.round((y - floor) * UNITS);
    d += i ? `${i > 1 ? ' ' : ''}${X - px}${Y - py < 0 ? '' : ' '}${Y - py}` : `M${X} ${Y}l`;
    (px = X), (py = Y);
  });
  return d + (closed ? 'z' : '');
}
const UNITS = 8;

/** A picture's rows: what stands on each, its floor line, and the cloud that follows it, in the order it is drawn. */
function rowsOf(pic) {
  const rows = [{ land: [], line: null, sky: [] }];
  for (const s of pic.shapes) {
    const row = rows.at(-1);
    if (s.line) (row.line ? rows.push({ land: [], line: s, sky: [] }) : (row.line = s));
    else if (s.cloud || s.shadow) row.sky.push(s);
    else if (row.line) rows.push({ land: [s], line: null, sky: [] });
    else row.land.push(s);
  }
  return rows;
}

/**
 * The animated SVG: a = { pic, fill } the start and b the end, fill(s) a shape's colour as the page paints it; keys
 * from keysOf. Shapes in draw order that start together share one group and one clock, so a clock costs little.
 */
export function svgOf({ a, b, keys, morph: m, ink, swellColour, background, cloudOpacity = 0.92 }) {
  const { width: W, height: H } = a.pic, xs = keys[0].xs;
  const clock = (t) => (m.wait + t * (m.seconds - m.rise)).toFixed(2);
  const scale = (r, t, up) => `<animateTransform attributeName="transform" type="scale" begin="${clock(t)}s" dur="${m.rise}s" fill="freeze" values="${up ? '1 0;1 1' : '1 1;1 0'}"/>`;
  const fade = (t, up) => `<animate attributeName="opacity" begin="${clock(t)}s" dur="${m.rise}s" fill="freeze" values="${up ? '0;1' : '1;0'}"/>`;
  // When land comes to each place in each row: the first key it stands there, or never. Land already there at the
  // start is taken over in a slow wash across the page, so the first moments are not all of it changing at once.
  const first = keys[0].rows.map((_, r) => keys[0].xs.map((_, i) => {
    const k = keys.findIndex((pic) => pic.rows[r].h[i] >= 0.5);
    return k < 0 ? 1 : k ? k / (keys.length - 1) : 0.6 * (i / xs.length);
  }));
  const when = (s, r) => {
    const row = first[Math.min(r, first.length - 1)];
    let soonest = 1;
    for (let q = 0; q < s.points.length; q += 6) soonest = Math.min(soonest, row[Math.max(0, Math.min(xs.length - 1, Math.round((s.points[q][0] - xs[0]) / 2)))] ?? 1);
    return Math.round(soonest * m.steps) / m.steps;
  };
  const draw = (s, floor, set) => {
    // Land takes the line the whole picture is given: only finer lines say their own.
    const stroke = 'sea' in s || s.cloud ? ` stroke-width="${(('sea' in s ? 0.5 : 0.6) * a.pic.line * UNITS).toFixed(2)}"` : '';
    if (s.shadow) return `<path fill="#000" fill-opacity="${(0.35 * s.shadow).toFixed(3)}" stroke="none" d="${written(s.points, m.detail, floor, true)}"/>`;
    if (s.cloud) return `<path fill="${set.fill(s)}" fill-opacity="${cloudOpacity}"${stroke} d="${written(s.points, m.detail, floor, true)}"/>`;
    return `<path fill="${set.fill(s)}"${stroke} d="${written(s.points, m.detail, floor, true)}"/>`;
  };
  const reach = (s) => [Math.min(...s.points.map((p) => p[0])), Math.max(...s.points.map((p) => p[0]))];
  /** A row's land from one picture: shapes that touch, in draw order, rise or sink as one, at the soonest of them. */
  const land = (shapes, r, floor, set, up) => {
    let out = '';
    for (let i = 0; i < shapes.length; ) {
      let [lo, hi] = reach(shapes[i]), t = when(shapes[i], r), j = i + 1;
      for (; j < shapes.length; j++) {
        const [a0, a1] = reach(shapes[j]);
        if (a0 > hi || a1 < lo) break;
        (lo = Math.min(lo, a0)), (hi = Math.max(hi, a1)), (t = Math.min(t, when(shapes[j], r)));
      }
      const body = shapes.slice(i, j).map((s) => draw(s, floor, set)).join('');
      out += `<g${up ? ' transform="scale(1 0)"' : ''}>${scale(r, t, up)}${body}</g>`;
      i = j;
    }
    return out;
  };
  const [as, bs] = [rowsOf(a.pic), rowsOf(b.pic)];
  let body = '';
  for (let r = 0; r < Math.max(as.length, bs.length); r++) {
    const [x, y] = [as[r] ?? { land: [], sky: [] }, bs[r] ?? { land: [], sky: [] }], floor = (x.line ?? y.line)?.points[0][1] ?? keys[0].rows[Math.min(r, keys[0].rows.length - 1)].y;
    body += `<g transform="translate(0 ${+(floor * UNITS).toFixed(2)})">${land(x.land, r, floor, a, false)}${land(y.land, r, floor, b, true)}`;
    if (x.line) body += `<path fill="none" stroke="${swellColour}" stroke-width="${(Math.max(0.6, a.pic.line * 0.8) * UNITS).toFixed(1)}" d="${written(x.line.points, 0, floor, false)}"/>`;
    if (x.sky.length) body += `<g>${fade(1, false)}${x.sky.map((s) => draw(s, floor, a)).join('')}</g>`;
    if (y.sky.length) body += `<g opacity="0">${fade(0.5, true)}${y.sky.map((s) => draw(s, floor, b)).join('')}</g>`;
    body += '</g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * UNITS} ${H * UNITS}"><rect width="${W * UNITS}" height="${H * UNITS}" fill="${background}"/><g stroke="${ink}" stroke-width="${(a.pic.line * UNITS).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}
