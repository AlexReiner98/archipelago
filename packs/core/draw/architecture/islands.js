// The islands look of a story (a step's `look: "islands"`): the same parts and wires as the boxes, drawn as an
// archipelago. Each part is an island around its name, placed on a soft arc in the order its work comes (what it
// needs before it), sized by what it holds and rising a little once it is done; each wire is a curved sea route the
// way the wire goes (between two pieces of work, from what is needed to what needs it), with what it carries written
// beside it, clear of every route, island and route end. A box and an island are both outlines of eight curves from
// the same corner, so one moves into the other point by point. Pure: a layout in, geometry out. Every length is the
// style's (sizes, arch_island_*).

const round = (v) => Math.round(v * 100) / 100;
const pt = (p) => `${round(p[0])} ${round(p[1])}`;
/** A number in [0, 1) for a name: the same every time, so an island keeps its shape. */
export function hashOf(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}
/** An outline of eight curves, from its top left: M p C c c p ... Z. */
const outline = (start, segs) => `M${pt(start)}${segs.map(([a, b, p]) => `C${pt(a)} ${pt(b)} ${pt(p)}`).join('')}Z`;
const K = 0.5523;

/** A box with round corners as eight curves: four straight sides and four corners, from the end of its top left corner. */
export function boxPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = K * r, [R, B] = [x + w, y + h];
  const side = (p, q) => [[p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3], [p[0] + ((q[0] - p[0]) * 2) / 3, p[1] + ((q[1] - p[1]) * 2) / 3], q];
  const P = [[x + r, y], [R - r, y], [R, y + r], [R, B - r], [R - r, B], [x + r, B], [x, B - r], [x, y + r]];
  return outline(P[0], [side(P[0], P[1]), [[R - r + k, y], [R, y + r - k], P[2]], side(P[2], P[3]), [[R, B - r + k], [R - r + k, B], P[4]], side(P[4], P[5]), [[x + r - k, B], [x, B - r + k], P[6]], side(P[6], P[7]), [[x, y + r - k], [x + r - k, y], P[0]]]);
}

/** An island's outline: eight curves through eight points around cx, cy, each a little in or out (wobble). */
function islandCurves(cx, cy, rx, ry, seed, wobble) {
  const P = [-112.5, -67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5].map((deg, k) => {
    const a = (deg * Math.PI) / 180, s = 1 + wobble * (hashOf(`${seed}:${k}`) * 2 - 1);
    return [cx + rx * s * Math.cos(a), cy + ry * s * Math.sin(a)];
  });
  const at = (k) => P[(k + 8) % 8];
  // Through every point smoothly: each curve's handles along the line through the points either side.
  return [P[0], P.map((_, k) => [[at(k)[0] + (at(k + 1)[0] - at(k - 1)[0]) / 6, at(k)[1] + (at(k + 1)[1] - at(k - 1)[1]) / 6], [at(k + 1)[0] - (at(k + 2)[0] - at(k)[0]) / 6, at(k + 1)[1] - (at(k + 2)[1] - at(k)[1]) / 6], at(k + 1)])];
}
/** An island centred on cx, cy, as a path. */
export const islandPath = (...args) => outline(...islandCurves(...args));
/** The same island as points along its outline, `each` to a curve. */
export function islandPoints(cx, cy, rx, ry, seed, wobble, each = 8) {
  const [start, segs] = islandCurves(cx, cy, rx, ry, seed, wobble);
  let from = start;
  return segs.flatMap(([a, b, p]) => {
    const pts = Array.from({ length: each }, (_, k) => along([from, a, b, p], k / each));
    from = p;
    return pts;
  });
}

/** How the islands look beyond their marks: a look's key is shown only while the story is in it. */
export const css = `.sp-key.sp-hide { display: none; }`;

/** A route as a path: one curve, [start, handle, handle, end]. */
export const curveOf = (p) => `M${pt(p[0])}C${pt(p[1])} ${pt(p[2])} ${pt(p[3])}`;
/** A point along a route, t from 0 to 1. */
export const along = (p, t) => [0, 1].map((i) => (1 - t) ** 3 * p[0][i] + 3 * (1 - t) ** 2 * t * p[1][i] + 3 * (1 - t) * t ** 2 * p[2][i] + t ** 3 * p[3][i]);

/**
 * A layout (layout.js) as islands: where each part sits (x, y), how big its island is (radii: rx, ry, and `rise`, what a
 * finished one grows by), each wire as a route (points: a curve's four points, the way the wire goes) and the whole
 * size. `done(n)` says whether a part's work is finished.
 */
export function islands(g, { z, n: num, done }) {
  const parts = g.all.filter((n) => !n.dummy);
  const [PAD, RISE, GAP, MARGIN] = ['island_pad', 'island_rise', 'island_gap', 'margin'].map(z);
  const [bow, wobble, arc, squash] = ['arch_island_bow', 'arch_island_wobble', 'arch_island_arc', 'arch_island_squash'].map(num);
  // What each part holds makes its island bigger: half a pad more each time it doubles.
  const size = (n) => PAD * (1 + Math.log2(1 + Math.max(0, Number(n.item.within?.items) || 0)) / 2);
  // Rounder than the box it holds: more sea above and below its name than beside it.
  const radii = new Map(parts.map((n) => [n.id, { rx: n.w / 2 + size(n) * 0.6, ry: n.h / 2 + size(n) * 1.5, rise: done(n) ? RISE : 0 }]));
  // The order things come in: a part after everything whose wires come to it (as drawn: turned back, the other way).
  const needs = new Map(parts.map((n) => [n.id, []]));
  for (const c of g.chains) {
    const [from, to] = c.back ? [c.b, c.a] : [c.a, c.b];
    if (needs.has(from) && needs.has(to)) needs.get(to).push(from);
  }
  const depth = new Map();
  const deep = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...needs.get(id).map((o) => deep(o, seen))) + 1;
    depth.set(id, d);
    return d;
  };
  for (const n of parts) deep(n.id);
  // Parts no wire touches (projects apart from each other) each take a step of their own along the arc, in their order.
  const touched = new Set(g.chains.flatMap((c) => [c.a, c.b]));
  let next = Math.max(-1, ...[...depth].filter(([id]) => touched.has(id)).map(([, d]) => d)) + 1;
  for (const n of [...parts].sort((a, b) => (a.item.place ?? 0) - (b.item.place ?? 0))) if (!touched.has(n.id)) depth.set(n.id, next++);
  const last = Math.max(0, ...depth.values());
  const cols = Array.from({ length: last + 1 }, (_, d) => parts.filter((n) => depth.get(n.id) === d));
  // Each step of the order a place along an arc (`arc` half turns, squashed to `squash` as high as wide), from the left
  // up over the top and down to the right; what comes at the same step lies further out or further in. The arc is as
  // big as the widest island needs.
  const widest = Math.max(...[...radii.values()].map((r) => 2 * (r.rx + RISE)));
  const tallest = Math.max(...[...radii.values()].map((r) => 2 * (r.ry + RISE)));
  const R = Math.max(((last + 1) * (widest + GAP)) / (Math.PI * arc), tallest + GAP);
  const x = new Map(), y = new Map();
  cols.forEach((col, d) => {
    const a = (3 * Math.PI) / 2 + Math.PI * arc * ((d + 0.5) / (last + 1) - 0.5);
    col.forEach((n, k) => {
      const out = R + (k - (col.length - 1) / 2) * (tallest + GAP) + (hashOf(n.id) - 0.5) * GAP * wobble * 2;
      x.set(n.id, Math.cos(a) * out);
      y.set(n.id, Math.sin(a) * out * squash);
    });
  });
  // Pushed apart where two islands, with the sea between them, would touch.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const [a, b] = [parts[i].id, parts[j].id], [ra, rb] = [radii.get(a), radii.get(b)];
        const dx = x.get(b) - x.get(a), dy = y.get(b) - y.get(a);
        const ox = ra.rx + rb.rx + 2 * RISE + GAP / 2 - Math.abs(dx), oy = ra.ry + rb.ry + 2 * RISE + GAP / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Along the way they overlap least.
        if (ox / (ra.rx + rb.rx) < oy / (ra.ry + rb.ry)) {
          const s = (dx >= 0 ? 1 : -1) * (ox / 2);
          (x.set(a, x.get(a) - s), x.set(b, x.get(b) + s));
        } else {
          const s = (dy >= 0 ? 1 : -1) * (oy / 2);
          (y.set(a, y.get(a) - s), y.set(b, y.get(b) + s));
        }
      }
    if (!moved) break;
  }
  // Moved to start at the margin.
  const ext = (id, sign, axis) => (axis === x ? x.get(id) + sign * (radii.get(id).rx + RISE) : y.get(id) + sign * (radii.get(id).ry + RISE));
  const left = Math.min(...parts.map((n) => ext(n.id, -1, x))), top = Math.min(...parts.map((n) => ext(n.id, -1, y)));
  for (const n of parts) (x.set(n.id, x.get(n.id) - left + MARGIN), y.set(n.id, y.get(n.id) - top + MARGIN));
  const width = Math.max(...parts.map((n) => ext(n.id, 1, x))) + MARGIN, height = Math.max(...parts.map((n) => ext(n.id, 1, y))) + MARGIN;

  // A route goes the way its wire does, from the edge of one island to the edge of the other, bowed to one side.
  const edge = (id, ux, uy, more) => {
    const r = radii.get(id), t = 1 / Math.hypot(ux / (r.rx + r.rise), uy / (r.ry + r.rise));
    return [x.get(id) + ux * (t + more), y.get(id) + uy * (t + more)];
  };
  const chains = g.chains.flatMap((c) => {
    if (!x.has(c.a) || !x.has(c.b)) return [];
    const [start, end] = c.back ? [c.b, c.a] : [c.a, c.b];
    const dx = x.get(end) - x.get(start), dy = y.get(end) - y.get(start), len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const p0 = edge(start, ux, uy, 2), p3 = edge(end, -ux, -uy, 3);
    const side = hashOf(c.key) < 0.5 ? -1 : 1, b = bow * Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) * side;
    const handle = (f) => [p0[0] + (p3[0] - p0[0]) * f - uy * b, p0[1] + (p3[1] - p0[1]) * f + ux * b];
    return [{ ...c, a: start, b: end, back: false, curve: true, points: [p0, handle(1 / 3), handle(2 / 3), p3] }];
  });
  return { ...g, x, y, chains, boxes: [], breaks: [], left: 0, width, height, radii };
}

/** Where each of `labels` ({ c: a route, text }) is written beside its route, as { c, text, x, y, w }; those with no room are left out. */
export function routeSpots({ labels, chains, radii, x, y, measure, z }) {
  const [SAYS_TEXT, HIGH, PAD] = [z('says_text'), z('says_height'), z('says_pad')];
  const ROOM = 3;
  // Every route as points close together, and both its ends.
  const dots = chains.map((c) => [c, Array.from({ length: 49 }, (_, k) => along(c.points, k / 48))]);
  const ends = chains.flatMap((c) => [c.points[0], c.points[3]]);
  const isles = [...radii].map(([id, r]) => [x.get(id), y.get(id), r.rx + r.rise + ROOM, r.ry + r.rise + ROOM]);
  const placed = [];
  const clear = (c, lx, ly, w) => {
    const inBox = ([px, py], more = 0) => Math.abs(px - lx) <= w / 2 + more && Math.abs(py - ly) <= HIGH / 2 + more;
    if (dots.some(([o, pts]) => o !== c && pts.some((p) => inBox(p, ROOM)))) return false;
    if (ends.some((p) => inBox(p, 9))) return false;
    // An island's outline is near its ellipse: the words keep out of the box around it, eased at its corners.
    if (isles.some(([cx, cy, rx, ry]) => ((Math.max(0, Math.abs(lx - cx) - w / 2) / rx) ** 2 + (Math.max(0, Math.abs(ly - cy) - HIGH / 2) / ry) ** 2) < 1)) return false;
    return !placed.some(([px, py, pw]) => Math.abs(px - lx) < (pw + w) / 2 + 4 && Math.abs(py - ly) < HIGH + 2);
  };
  return labels.flatMap(({ c, text }) => {
    const w = measure(text, SAYS_TEXT) + 2 * PAD, p = c.points;
    // On the route near its middle, else beside it, either side.
    const spots = [0.5, 0.4, 0.6, 0.3, 0.7].flatMap((t) => {
      const [mx, my] = along(p, t), [ax, ay] = along(p, t - 0.02), [bx, by] = along(p, t + 0.02);
      const len = Math.hypot(bx - ax, by - ay) || 1, [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
      // Beside it, far enough that the words' box clears the route.
      const off = (Math.abs(nx) * w) / 2 + (Math.abs(ny) * HIGH) / 2 + ROOM + 2;
      return [[mx, my], [mx + nx * off, my + ny * off], [mx - nx * off, my - ny * off]];
    });
    const spot = spots.find(([lx, ly]) => clear(c, lx, ly, w));
    if (!spot) return [];
    placed.push([...spot, w]);
    return [{ c, text, x: spot[0], y: spot[1], w }];
  });
}
