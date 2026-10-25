// One repeating pattern from a few dials and a palette: shapes on a tile, with no page.
//
// The shape a pack drawing will take later (docs/drawings.md): input in, shapes out, the same
// shapes for the same seed. Every dial runs 0 to 1:
//   substrate  basalt facets, kelp fronds, branching coral, polyps
//   density    bare to dense
//   order      loose scatter to strict kaleidoscope (wallpaper groups p1 .. p6m)
//   line       hairline to bold
// A palette is six colours: ground, four accents, ink.

export const PLACES = {
  faroe: { title: 'Faroe', palette: ['#dfe4df', '#4f6b5a', '#2f3a40', '#9bb3a1', '#c9a96b', '#1d2428'] },
  galapagos: { title: 'Galápagos', palette: ['#ebdfc8', '#3b3a36', '#c4562e', '#6fa4a0', '#d9a441', '#22201d'] },
  rajaAmpat: { title: 'Raja Ampat', palette: ['#0f4c5c', '#2bb3a6', '#f2c14e', '#e76f51', '#8fd3c9', '#062b33'] },
  haidaGwaii: { title: 'Haida Gwaii', palette: ['#e6e2d6', '#2f4a3c', '#8a3b2b', '#6b8f8a', '#b9a27a', '#18201c'] },
};

// ---- colour: blended in OKLab, so a mix of two places stays as bright as either ----

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function oklab([r, g, b]) {
  [r, g, b] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function srgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(gam);
}
export const blend = (a, b, t) => a.map((c, i) => toHex(srgb(oklab(hex(c)).map((v, k) => v + (oklab(hex(b[i]))[k] - v) * t))));

// ---- randomness from a seed ----

const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- motifs: each draws inside the wedge from angle 0 to A, radius R, around the origin ----
// A shape is { ops } (M, L, Q, Z with points) or { circle: [x, y, r] }, with fill, stroke and width.

const at = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

function basalt(rnd, R, A, d, k) {
  const out = [];
  const rings = 2 + Math.round(d.density * 4);
  const gap = 0.6 + d.line * 2.5;
  for (let i = 0; i < rings; i++) {
    const r0 = (R * i) / rings + gap, r1 = (R * (i + 1)) / rings - gap;
    const cells = Math.max(1, Math.round((i + 1) * (0.5 + d.density * 1.5) * (A / Math.PI)));
    for (let j = 0; j < cells; j++) {
      if (rnd() > 0.35 + d.density * 0.65 * k) continue;
      const a0 = (A * j) / cells + gap / Math.max(r0, 4), a1 = (A * (j + 1)) / cells - gap / Math.max(r0, 4);
      if (a1 <= a0) continue;
      out.push({ ops: [['M', ...at(r0, a0)], ['L', ...at(r1, a0)], ['L', ...at(r1, a1)], ['L', ...at(r0, a1)], ['Z']], fill: [1, 2, 4][Math.floor(rnd() * 3)] });
    }
  }
  return out;
}

function frond(rnd, R, A, d, k) {
  const out = [];
  const phi = A / 2, bend = (rnd() - 0.5) * R * 0.3;
  const [x0, y0] = at(R * 0.08, phi), [x1, y1] = at(R * 0.95, phi);
  const [cx, cy] = [(x0 + x1) / 2 - Math.sin(phi) * bend, (y0 + y1) / 2 + Math.cos(phi) * bend];
  const point = (t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1];
  const leaves = Math.round((3 + d.density * 9) * k);
  for (let i = 0; i < leaves; i++) {
    const t = 0.12 + (0.85 * i) / Math.max(leaves, 1);
    const [px, py] = point(t);
    const side = i % 2 ? 1 : -1;
    const ang = phi + side * (0.7 + rnd() * 0.4);
    const len = R * 0.32 * (1 - t * 0.55), wid = len * (0.18 + d.density * 0.12);
    const [tx, ty] = [px + Math.cos(ang) * len, py + Math.sin(ang) * len];
    const [nx, ny] = [-Math.sin(ang) * wid, Math.cos(ang) * wid];
    const [mx, my] = [(px + tx) / 2, (py + ty) / 2];
    out.push({ ops: [['M', px, py], ['Q', mx + nx, my + ny, tx, ty], ['Q', mx - nx, my - ny, px, py], ['Z']], fill: 2 });
  }
  out.push({ ops: [['M', x0, y0], ['Q', cx, cy, x1, y1]], stroke: 5, width: 1 + d.line * 3 });
  return out;
}

function coral(rnd, R, A, d, k) {
  const out = [];
  const depth = 2 + Math.round(d.density * 2 * k);
  const grow = (x, y, ang, len, left) => {
    const [x2, y2] = [x + Math.cos(ang) * len, y + Math.sin(ang) * len];
    out.push({ ops: [['M', x, y], ['L', x2, y2]], stroke: 3, width: (0.8 + d.line * 4) * (0.5 + left / depth) });
    if (!left) return out.push({ circle: [x2, y2, 1.2 + d.line * 3], fill: 1 });
    const spread = 0.3 + rnd() * 0.35;
    const kids = rnd() < d.density * 0.6 ? 3 : 2;
    for (let i = 0; i < kids; i++) grow(x2, y2, ang + spread * (i - (kids - 1) / 2) * 1.6, len * (0.62 + rnd() * 0.12), left - 1);
  };
  grow(...at(R * 0.06, A / 2), A / 2, R * 0.34, depth);
  return out;
}

function polyps(rnd, R, A, d, k) {
  const out = [];
  const count = Math.round((3 + d.density * 12) * k);
  for (let i = 0; i < count; i++) {
    const [x, y] = at(R * (0.15 + 0.8 * rnd()), A * rnd());
    const r = R * (0.03 + 0.1 * rnd()) * (1 - 0.4 * d.density);
    if (rnd() < 0.5) out.push({ circle: [x, y, r], fill: 4 }, { circle: [x, y, r * 0.35], fill: 5 });
    else out.push({ circle: [x, y, r], stroke: 3, width: 0.6 + d.line * 2.5 });
  }
  return out;
}

/** A closed curve through the midpoints of points, rounded at each: a pebble, a lobe, a leaf. */
function smooth(pts) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ops = [['M', ...mid(pts[pts.length - 1], pts[0])]];
  pts.forEach((p, i) => ops.push(['Q', ...p, ...mid(p, pts[(i + 1) % pts.length])]));
  return [...ops, ['Z']];
}
/** n points round (x, y), radius r, each pushed out by lobe(t). */
const ring = (x, y, r, n, lobe = () => 1, turn = 0) => Array.from({ length: n }, (_, i) => at(r * lobe((i / n) * 2 * Math.PI), turn + (i / n) * 2 * Math.PI)).map(([px, py]) => [x + px, y + py]);

// Rock strata and tide lines: wavy bands across the wedge.
function strata(rnd, R, A, d, k) {
  const out = [];
  const bands = Math.round((3 + d.density * 6) * k);
  const steps = Math.max(3, Math.round(A * 4));
  for (let i = 0; i < bands; i++) {
    const r = R * (0.2 + (0.78 * (i + 0.5)) / bands), amp = R * 0.04 * (1 + rnd()), freq = 2 + Math.floor(rnd() * 3), phase = rnd() * 6;
    const pts = Array.from({ length: steps + 1 }, (_, j) => at(r + amp * Math.sin(freq * (j / steps) * Math.PI * 2 + phase), (A * j) / steps));
    const ops = [['M', ...pts[0]]];
    for (let j = 1; j < pts.length - 1; j++) ops.push(['Q', ...pts[j], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2]);
    ops.push(['L', ...pts[pts.length - 1]]);
    out.push({ ops, stroke: i % 3 === 2 ? 5 : i % 2 ? 2 : 1, width: 0.6 + d.line * (i % 2 ? 2 : 4) });
  }
  return out;
}

// Shingle beaches: rounded pebbles, packed loosely.
function shingle(rnd, R, A, d, k) {
  const out = [];
  const count = Math.round((4 + d.density * 12) * k);
  for (let i = 0; i < count; i++) {
    const [x, y] = at(R * (0.12 + 0.82 * Math.sqrt(rnd())), A * rnd());
    const r = R * (0.04 + 0.09 * rnd()) * (1.2 - 0.5 * d.density), squash = 0.55 + rnd() * 0.4, turn = rnd() * 3;
    const pts = ring(0, 0, r, 6, (t) => 0.85 + 0.25 * rnd()).map(([px, py]) => [x + px * Math.cos(turn) - py * squash * Math.sin(turn), y + px * Math.sin(turn) + py * squash * Math.cos(turn)]);
    out.push({ ops: smooth(pts), fill: [1, 3, 4][i % 3], stroke: d.line > 0.5 ? 5 : undefined, width: 0.5 + (d.line - 0.5) * 2 });
  }
  return out;
}

// Lichen on rock: lobed rings, one inside another.
function lichen(rnd, R, A, d, k) {
  const out = [];
  const count = Math.max(1, Math.round((1 + d.density * 4) * k));
  for (let i = 0; i < count; i++) {
    const [x, y] = at(R * (0.25 + 0.6 * rnd()), A * (0.15 + 0.7 * rnd()));
    const r = R * (0.08 + 0.14 * rnd()), lobes = 5 + Math.floor(rnd() * 5), wob = 0.12 + 0.12 * rnd();
    [[1, 4], [0.68, 0], [0.4, 1]].forEach(([s, fill]) => out.push({ ops: smooth(ring(x, y, r * s, lobes * 2, (t) => 1 + wob * Math.sin(lobes * t))), fill }));
    out.push({ circle: [x, y, r * 0.12], fill: 5 });
  }
  return out;
}

// Seagrass: thin tapered blades fanning from a root.
function seagrass(rnd, R, A, d, k) {
  const out = [];
  const blades = Math.round((4 + d.density * 10) * k);
  const [bx, by] = at(R * 0.1, A / 2);
  for (let i = 0; i < blades; i++) {
    const ang = A * (0.1 + 0.8 * (i + rnd() * 0.5) / blades), len = R * (0.5 + 0.45 * rnd()), sway = (rnd() - 0.5) * 0.8;
    const [tx, ty] = [bx + Math.cos(ang + sway) * len, by + Math.sin(ang + sway) * len];
    const [cx, cy] = [bx + Math.cos(ang) * len * 0.55, by + Math.sin(ang) * len * 0.55];
    const wid = 0.8 + d.line * 2.5 + d.density;
    const [nx, ny] = [-Math.sin(ang) * wid, Math.cos(ang) * wid];
    out.push({ ops: [['M', bx - nx, by - ny], ['Q', cx - nx, cy - ny, tx, ty], ['Q', cx + nx, cy + ny, bx + nx, by + ny], ['Z']], fill: i % 3 ? 1 : 3 });
  }
  return out;
}

// From rock to reef: the order the substrate dial runs through.
const FAMILIES = [basalt, strata, shingle, lichen, seagrass, frond, coral, polyps];

// ---- lattices: strict to loose ----

const GROUPS = [
  { name: 'p6m', n: 6, mirror: true, lattice: 'hex' },
  { name: 'p4m', n: 4, mirror: true, lattice: 'square' },
  { name: 'p3m1', n: 3, mirror: true, lattice: 'hex' },
  { name: 'p6', n: 6, mirror: false, lattice: 'hex' },
  { name: 'p4', n: 4, mirror: false, lattice: 'square' },
  { name: 'p2', n: 2, mirror: false, lattice: 'square' },
  { name: 'p1', n: 1, mirror: false, lattice: 'scatter' },
];

const mul = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const rot = (a, s = 1, x = 0, y = 0) => [Math.cos(a) * s, Math.sin(a) * s, -Math.sin(a) * s, Math.cos(a) * s, x, y];
const then = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const FLIP = [1, 0, 0, -1, 0, 0];

const n1 = (v) => +v.toFixed(1);
function path(shape, m) {
  if (shape.circle) {
    const [x, y] = mul(m, shape.circle), r = n1(shape.circle[2] * Math.hypot(m[0], m[1]));
    return `M${n1(x - r)} ${n1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  return shape.ops.map(([c, ...p]) => c + (p.length ? (c === 'Q' ? [...mul(m, p), ...mul(m, p.slice(2))] : mul(m, p)).map(n1).join(' ') : '')).join('');
}

/** The pattern: { w, h, ground, group, shapes: [{ d, fill, stroke, width }] } in tile units. */
export function pattern({ dials, palette, seed = 1 }) {
  const d = { substrate: 0.5, density: 0.5, order: 0.8, line: 0.3, ...dials };
  const rnd = random(seed * 9973);
  const group = GROUPS[Math.round((1 - d.order) * (GROUPS.length - 1))];
  const U = 100;
  const A = group.mirror ? Math.PI / group.n : (2 * Math.PI) / group.n;

  // What goes in one wedge: the families near the substrate dial, the nearest weighed most.
  const wedge = [];
  const span = 1 / (FAMILIES.length - 1);
  FAMILIES.forEach((draw, i) => {
    const k = 1 - Math.abs(d.substrate - i * span) / (span * 1.6);
    if (k > 0.05) wedge.push(...draw(rnd, U * 0.5, A, d, Math.min(1, k + 0.2)));
  });

  // The rosette: the wedge turned (and mirrored) round its centre.
  const rosette = [];
  for (let i = 0; i < group.n; i++) {
    rosette.push(rot((2 * Math.PI * i) / group.n));
    if (group.mirror) rosette.push(then(rot((2 * Math.PI * i) / group.n), FLIP));
  }

  // Where rosettes stand on the tile.
  let w = U, h = U, R = U * 0.5;
  let places = [[0, 0, 0, 1], [U / 2, U / 2, 0, group.n === 2 ? 1 : 0]];
  if (group.lattice === 'hex') (h = U * Math.sqrt(3)), (places = [[0, 0, 0, 1], [U / 2, h / 2, 0, 1]]);
  if (group.lattice === 'square') places = group.n === 2 ? [[0, 0, 0, 1], [U / 2, U / 2, Math.PI / 2, 0.7]] : [[0, 0, 0, 1]];
  // Below strict, each rosette on a tile twice as wide leans, shrinks and strays a little, more the looser the order.
  const loose = Math.min(1, Math.max(0, (0.9 - d.order) / 0.9));
  if (group.lattice !== 'scatter' && loose > 0.08) {
    places = [...places, ...places.map(([x, y, a, s]) => [x + w, y, a, s])].map(([x, y, a, s]) => [x + (rnd() - 0.5) * loose * U * 0.2, y + (rnd() - 0.5) * loose * U * 0.2, a + (rnd() - 0.5) * loose * 0.9, s * (1 - loose * 0.35 * rnd())]);
    w *= 2;
  }
  if (group.lattice === 'scatter') {
    w = h = U * 2;
    // Spaced as things grow, not thrown: each clump keeps its distance from the others, across the seams too.
    const far = (x, y, gap) => places.every(([px, py, , ps]) => Math.hypot(Math.min(Math.abs(x - px), w - Math.abs(x - px)), Math.min(Math.abs(y - py), h - Math.abs(y - py))) > gap * (0.5 + ps * 0.5));
    // A current drifts across the tile, and each clump turns with it; the field repeats with the tile.
    const [p1, p2] = [rnd() * 6, rnd() * 6];
    const drift = (x, y) => 1.3 * Math.sin((2 * Math.PI * x) / w + p1) + 1.3 * Math.cos((2 * Math.PI * y) / h + p2);
    places = [];
    for (const [count, size, gap] of [[3 + Math.round(d.density * 3), [0.75, 0.55], U * 0.9], [4 + Math.round(d.density * 8), [0.3, 0.2], U * 0.45]]) {
      for (let tries = 0, n = 0; tries < 300 && n < count; tries++) {
        const [x, y] = [rnd() * w, rnd() * h];
        const s = size[0] + size[1] * rnd() ** 2;
        if (far(x, y, gap)) places.push([x, y, drift(x, y) + (rnd() - 0.5) * 0.5, s]), n++;
      }
    }
    // A loose clump is the wedge drawn three times, unevenly: it grows like a colony, not a star.
    rosette.splice(0, rosette.length, ...[0, 1, 2].map((i) => rot(i * 2.1 + rnd() * 0.6, 1 - i * 0.18)));
    R *= 1.3;
  }

  // The motif is written once; each rosette stands wherever it reaches into the tile, so the tile repeats with no seam.
  const motif = wedge.map((shape) => ({ d: path(shape, rot(0)), fill: shape.fill != null ? palette[shape.fill] : 'none', stroke: shape.stroke != null ? palette[shape.stroke] : 'none', width: shape.width ?? 0 }));
  const placements = [];
  for (const [x, y, a, s] of places) {
    if (!s) continue;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      const [cx, cy] = [x + dx, y + dy];
      if (cx < -R * s || cx > w + R * s || cy < -R * s || cy > h + R * s) continue;
      const place = rot(a, s, cx, cy);
      // A small clump is drawn once, not three times: it reads the same and costs a third.
      for (const r of s < 0.5 && group.lattice === 'scatter' ? rosette.slice(0, 1) : rosette) placements.push(then(place, r).map((v) => +v.toFixed(3)));
    }
  }
  return { w, h, ground: palette[0], group: group.name, motif, placements };
}

/** The pattern as an SVG <pattern> element's inside, for a page or a test to look at: the motif once, then placed. */
export const svgTile = ({ w, h, ground, motif, placements }, id = 'm') =>
  `<defs><g id="${id}">` +
  motif.map((s) => `<path d="${s.d}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${n1(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') +
  `</g></defs><rect width="${w}" height="${h}" fill="${ground}"/>` +
  placements.map((m) => `<use href="#${id}" transform="matrix(${m.join(' ')})"/>`).join('');
