// Plants, mosses and fungi. Each grows from its base at (0, 0), upward (negative y), from a species card g.
// A shape is { d, fill, edge } (colour by role, ink silhouette under it) or { d, line, w } (ink on top).

import { between, choose, closed, open, circle, turn, shake, bez, band, leaf } from './shapes.js';

/** A fern frond: a curving stem, paired pinnae shrinking to the tip, lobed or plain, maybe a fiddlehead. */
export function fern(rnd, g) {
  const out = [];
  const L = between(rnd, ...g.len), lean = between(rnd, -0.35, 0.35);
  const a = [0, 0], c = [lean * L * 0.6, -L * 0.6], b = [lean * L, -L];
  const pairs = Math.round(between(rnd, ...g.pairs));
  for (let i = 0; i < pairs; i++) {
    const t = 0.12 + (0.86 * i) / pairs, p = bez(a, c, b, t), q = bez(a, c, b, Math.min(1, t + 0.02));
    const up = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const len = L * g.pinna * Math.sin(Math.PI * (0.15 + t * 0.85)) ** 0.7 * (1 - t * 0.35);
    for (const s of [1, -1]) {
      const ang = up + s * (Math.PI / 2 - g.sweep);
      out.push({ d: closed(shake(rnd, leaf(p, ang, len, len * g.wide, { lobes: g.lobes, depth: g.depth, bend: -s * 0.15 }), 0.6)), fill: i % 2 ? 'leaf' : 'leaf2', edge: 0.7 });
    }
  }
  out.push({ d: open(Array.from({ length: 9 }, (_, i) => bez(a, c, b, i / 8))), line: 'ink', w: 1.4 });
  if (g.curl && rnd() < 0.6) {
    const spiral = Array.from({ length: 14 }, (_, i) => turn([0, -(L * 0.12) * (1 - i / 16)], (i / 13) * 5, [b[0] + L * 0.1, b[1]]));
    out.push({ d: open([b, ...spiral]), line: 'ink', w: 1.3 });
  }
  return { shapes: out, r: L * 0.6 };
}

/** A moss cushion: a bumpy mound, stippled, with thin stalks carrying capsules. */
export function moss(rnd, g) {
  const out = [];
  const W = between(rnd, ...g.width), H = W * between(rnd, 0.3, 0.5);
  const top = Array.from({ length: 14 }, (_, i) => {
    const x = -W / 2 + (W * i) / 13;
    return [x, -H * (1 - (2 * x / W) ** 2) ** 0.6 - rnd() * H * 0.18];
  });
  out.push({ d: closed([...top, [W / 2, 2], [-W / 2, 2]]), fill: 'leaf2', edge: 0.8 });
  for (let i = 0; i < W * 0.9; i++) {
    const x = between(rnd, -W * 0.42, W * 0.42), y = -between(rnd, 1.5, H * (1 - (2 * x / W) ** 2) ** 0.6 * 0.9);
    out.push({ d: open([[x - 1.2, y + 1], [x, y - 0.6], [x + 1.2, y + 1]]), line: 'leaf', w: 0.8 });
  }
  const stalks = Math.round(between(rnd, ...g.stalks));
  for (let i = 0; i < stalks; i++) {
    const x = between(rnd, -W * 0.35, W * 0.35), y0 = -H * (1 - (2 * x / W) ** 2) ** 0.6 * 0.9, h = between(rnd, 0.6, 1.2) * H, lean = (rnd() - 0.5) * 6;
    const tip = [x + lean, y0 - h];
    out.push({ d: open([[x, y0], [x + lean * 0.3, y0 - h * 0.6], tip]), line: 'ink', w: 0.7 });
    out.push({ d: closed(leaf(tip, -Math.PI / 2 + lean * 0.12 + 0.5, 3.6, 1.2, { n: 5 })), fill: g.capsule, edge: 0.5 });
  }
  return { shapes: out, r: W * 0.55 };
}

/** A cap from its stem top: dome, cone, flat or funnel. Answers its outline and where its rim is. */
function cap(type, cw, ch, top) {
  const [x0, y0] = top, n = 10, upper = [], under = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = cw / 2 - cw * t, u = Math.abs(2 * t - 1);
    const y =
      type === 'cone' ? -ch * (1 - u) ** 0.75 :
      type === 'flat' ? -ch * (0.55 * (1 - u * u) + 0.35 * Math.max(0, 1 - u * 4)) :
      type === 'funnel' ? -ch * (0.25 + 0.75 * u ** 1.6) + Math.sin(t * 19) * ch * 0.05 :
      -ch * Math.sqrt(Math.max(0, 1 - u * u));
    upper.push([x0 + x, y0 + y]);
  }
  for (let i = 1; i < n; i++) {
    const t = i / n, x = -cw / 2 + cw * t, u = Math.abs(2 * t - 1);
    under.push([x0 + x, y0 + (type === 'funnel' ? ch * 0.55 * (1 - u) ** 1.5 : ch * 0.12 * (1 - u * u))]);
  }
  return { outline: [...upper, ...under], rim: [upper[0], upper[n]] };
}

/** A cluster of mushrooms on a scrap of ground: each with a stem, a cap of its kind, gills or ridges, maybe spots. */
export function mushrooms(rnd, g) {
  const out = [];
  const count = Math.round(between(rnd, ...g.cluster));
  const size = between(rnd, ...g.size);
  out.push({ d: closed(shake(rnd, Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2) * size * 0.9, Math.sin((i / 10) * Math.PI * 2) * size * 0.14]), 1)), fill: 'leaf2', edge: 0.6 });
  const all = Array.from({ length: count }, (_, i) => ({ s: i ? between(rnd, 0.45, 0.8) : 1, x: i ? (i % 2 ? 1 : -1) * between(rnd, 0.25, 0.55) * size : 0 }));
  for (const { s, x } of all.sort((p, q) => q.s - p.s)) {
    const sh = size * g.stem * s, sw = size * 0.11 * g.girth * s, cw = size * g.capW * s, ch = size * g.capH * s, tilt = (rnd() - 0.5) * 0.35;
    const top = turn([0, -sh], tilt, [x, 0]);
    const stem = band(Array.from({ length: 6 }, (_, i) => bez([x, 0], [x + tilt * sh * 0.2, -sh * 0.5], top, i / 5)), (t) => sw * (1.25 - t * 0.35) + (g.cap === 'funnel' ? t * t * sw * 1.4 : 0));
    out.push({ d: closed(stem), fill: g.cap === 'funnel' ? g.colour : 'pale', edge: 0.8 });
    if (g.ring) out.push({ d: open([turn([-sw * 1.2, -sh * 0.78], tilt, [x, 0]), turn([0, -sh * 0.74], tilt, [x, 0]), turn([sw * 1.2, -sh * 0.78], tilt, [x, 0])]), line: 'ink', w: 0.9 });
    const { outline, rim } = cap(g.cap, cw, ch, top);
    const capPts = outline.map((p) => turn([p[0] - top[0], p[1] - top[1]], tilt, top));
    out.push({ d: closed(shake(rnd, capPts, 0.5)), fill: g.colour, edge: 1 });
    const under = rim.map((p) => turn([p[0] - top[0], p[1] - top[1]], tilt, top));
    const gills = g.cap === 'funnel' ? 6 : 9;
    for (let i = 1; i < gills; i++) {
      const t = i / gills, edge = [under[0][0] + (under[1][0] - under[0][0]) * t, under[0][1] + (under[1][1] - under[0][1]) * t];
      const from = g.cap === 'funnel' ? turn([(t - 0.5) * sw, -sh * 0.55], tilt, [x, 0]) : top;
      out.push({ d: open([from, [(from[0] + edge[0]) / 2, (from[1] + edge[1]) / 2 + 1], edge]), line: 'ink', w: 0.45 });
    }
    if (g.spots) for (let i = 0; i < 5; i++) {
      const p = capPts[Math.floor(between(rnd, 2, 9))];
      out.push({ d: circle(p[0] + (top[0] - p[0]) * between(rnd, 0.15, 0.5), p[1] + (top[1] - p[1]) * 0.3 + ch * 0.1, between(rnd, 0.8, 1.8) * s), fill: 'pale', edge: 0 });
    }
  }
  return { shapes: out, r: size * 0.85 };
}

/** A flowering or fruiting sprig: a stem with alternate leaves and a head of berries, a pompom or flowers. */
export function sprig(rnd, g) {
  const out = [];
  const L = between(rnd, ...g.len), lean = between(rnd, -0.4, 0.4);
  const a = [0, 0], c = [lean * L * 0.2, -L * 0.55], b = [lean * L * 0.5, -L];
  out.push({ d: closed(band(Array.from({ length: 8 }, (_, i) => bez(a, c, b, i / 7)), (t) => 1.3 - t * 0.6)), fill: g.stem ?? 'leaf', edge: 0.6 });
  const leaves = Math.round(between(rnd, ...g.leaves));
  for (let i = 0; i < leaves; i++) {
    const t = 0.15 + (0.7 * i) / leaves, p = bez(a, c, b, t), s = i % 2 ? 1 : -1;
    const len = L * g.leaf * (1 - t * 0.4);
    out.push({ d: closed(shake(rnd, leaf(p, -Math.PI / 2 + s * between(rnd, 0.6, 1.1), len, len * g.wide, { bend: s * 0.2, lobes: g.lobes ?? 0, depth: g.lobes ? 0.25 : 0 }), 0.5)), fill: i % 3 ? 'leaf' : 'leaf2', edge: 0.7 });
  }
  if (g.head === 'berries') for (let i = 0; i < g.many; i++) {
    const p = turn([between(rnd, -1, 1) * L * 0.09, between(rnd, -1, 1) * L * 0.07], 0, b), r = between(rnd, 2.2, 3.4);
    out.push({ d: circle(p[0], p[1], r), fill: g.colour, edge: 0.7 }, { d: circle(p[0] - r * 0.35, p[1] - r * 0.35, r * 0.25), fill: 'pale', edge: 0 });
  }
  if (g.head === 'pompom') {
    out.push({ d: circle(b[0], b[1], L * 0.11), fill: g.colour, edge: 0.8 });
    for (let i = 0; i < 14; i++) {
      const p = turn([L * 0.08 * Math.sqrt(rnd()), 0], rnd() * 6.3, b);
      out.push({ d: circle(p[0], p[1], 0.8), fill: 'pale', edge: 0 });
    }
  }
  if (g.head === 'flowers') for (let k = 0; k < g.many; k++) {
    const centre = k ? turn([L * 0.16, 0], -Math.PI / 2 + (k % 2 ? 0.9 : -0.9), b) : b, petals = g.petals ?? 5, pr = L * 0.08;
    if (k) out.push({ d: open([b, centre]), line: 'ink', w: 0.7 });
    for (let i = 0; i < petals; i++) out.push({ d: closed(leaf(centre, (i / petals) * Math.PI * 2 + k, pr, pr * 0.45, { round: 0.6, n: 6 })), fill: g.colour, edge: 0.7 });
    out.push({ d: circle(centre[0], centre[1], pr * 0.28), fill: g.eye ?? 'warm', edge: 0.5 });
  }
  return { shapes: out, r: L * 0.6 };
}

/** Something small for the gaps: a seed, a fallen leaf, a bud, a tuft of grass. */
export function filler(rnd, g) {
  const kind = choose(rnd, g.kinds);
  const s = between(rnd, 0.8, 1.3);
  if (kind === 'seed') return { shapes: [{ d: closed(leaf([0, 0], -Math.PI / 2, 5 * s, 2 * s, { n: 5 })), fill: 'earth', edge: 0.6 }], r: 4 * s };
  if (kind === 'dots') return { shapes: [0, 1, 2].map((i) => ({ d: circle(i * 3 - 3, (i % 2) * 2, 1.1 * s), fill: 'accent', edge: 0.4 })), r: 5 * s };
  if (kind === 'tuft') return { shapes: [-0.5, -0.2, 0.05, 0.3, 0.55].map((a) => ({ d: closed(band([[0, 0], turn([0, -7 * s], a * 0.5), turn([0, -between(rnd, 11, 16) * s], a)], (t) => 1 * (1 - t))), fill: 'leaf', edge: 0.5 })), r: 8 * s, upright: true };
  return { shapes: [{ d: closed(shake(rnd, leaf([0, 0], -Math.PI / 2 + (rnd() - 0.5), 9 * s, 3.5 * s, { bend: 0.2 }), 0.4)), fill: choose(rnd, ['warm', 'leaf2', 'earth']), edge: 0.6 }, { d: open([[0, 0], turn([0, -7 * s], 0.1)]), line: 'ink', w: 0.4 }], r: 6 * s };
}
