// Birds and small animals, from a species card g. A bird stands with its feet at (0, 0), facing +x.
// Shapes as in plants.js.

import { between, closed, open, circle, turn, shake, band, leaf } from './shapes.js';

/** A perched bird: body, head, tail, wing, beak, eye, legs, and the marks of its kind (cap, cheek, breast, crest). */
export function bird(rnd, g) {
  const out = [];
  const len = between(rnd, ...g.len), tilt = -between(rnd, 0.2, 0.5), rx = len / 2, ry = len * 0.3;
  const at = (x, y) => turn([x, y], tilt, [0, -ry * 1.75 - len * g.legs]);
  const c = at(0, 0);
  // Body: an egg, fuller in the breast than the back.
  const body = Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2, belly = Math.sin(t) > 0 ? 1.12 : 0.92, front = Math.cos(t) > 0 ? 1.05 : 1;
    return at(rx * Math.cos(t) * front, ry * Math.sin(t) * belly);
  });
  const head = at(rx * 0.82, -ry * 0.72), hr = ry * g.head;
  const tailAng = Math.PI + tilt + g.tailUp, rear = at(-rx * 0.82, -ry * 0.05), tl = len * g.tail;
  const tailEnd = turn([tl, 0], tailAng, rear);
  const tail = band([rear, turn([tl * 0.5, 0], tailAng, rear), tailEnd], (t) => ry * (0.42 + t * g.fan));
  out.push({ d: closed(tail), fill: g.wing, edge: 1 });
  // Legs and feet, under the body.
  for (const s of [-1, 1]) {
    const hip = at(s * rx * 0.12, ry * 0.8), foot = [s * 2.2, 0];
    out.push({ d: open([hip, foot]), line: 'ink', w: 1 }, { d: open([[foot[0] - 2.5, 0.4], [foot[0] + 3, 0.4]]), line: 'ink', w: 0.9 });
  }
  out.push({ d: closed(body), fill: g.body, edge: 1.1 });
  if (g.breast) out.push({ d: closed(Array.from({ length: 10 }, (_, i) => at(rx * (0.42 + 0.42 * Math.cos((i / 10) * 6.28)), ry * (0.28 + 0.62 * Math.sin((i / 10) * 6.28))))), fill: g.breast, edge: 0 });
  out.push({ d: circle(head[0], head[1], hr), fill: g.body, edge: 1.1 });
  if (g.cap) out.push({ d: closed([...Array.from({ length: 9 }, (_, i) => turn([hr, 0], Math.PI + 0.15 + (i / 8) * (Math.PI - 0.25), head)), turn([hr * 0.2, hr * 0.2], 0, head)]), fill: g.cap, edge: 0 });
  if (g.cheek) out.push({ d: closed(Array.from({ length: 8 }, (_, i) => turn([hr * 0.42 * Math.cos((i / 8) * 6.28), hr * 0.3 * Math.sin((i / 8) * 6.28)], -0.2, [head[0] - hr * 0.05, head[1] + hr * 0.38]))), fill: g.cheek, edge: 0 });
  if (g.crest) out.push({ d: closed([turn([hr * 0.6, 0], -2.1, head), turn([hr * 1.9, 0], -2.4 + tilt, head), turn([hr * 0.7, 0], -2.9, head)]), fill: g.cap ?? g.body, edge: 0.9 });
  // Wing: a long leaf over the body, with a few feathers drawn at its tip.
  const shoulder = at(rx * 0.3, -ry * 0.3), wa = Math.PI + tilt + 0.12, wl = rx * 1.45;
  out.push({ d: closed(shake(rnd, leaf(shoulder, wa, wl, ry * 0.5, { bend: -0.12, round: 0.6 }), 0.4)), fill: g.wing, edge: 0.9 });
  for (let i = 1; i <= 3; i++) {
    const from = turn([wl * (0.45 + i * 0.1), 0], wa, shoulder);
    out.push({ d: open([turn([0, -ry * 0.28], wa, from), turn([wl * 0.12, ry * 0.05], wa, from)]), line: 'ink', w: 0.6 });
  }
  // Beak: thick and short, or long and fine; curved down by g.hook.
  const ba = tilt * 0.4 + 0.08, base = turn([hr * 0.88, 0], ba, head), bl = len * g.beak, bw = hr * g.thick;
  const tip = turn([bl, bl * g.hook], ba, base);
  out.push({ d: closed([turn([0, -bw], ba, base), turn([bl * 0.55, -bw * 0.4 + bl * g.hook * 0.2], ba, base), tip, turn([bl * 0.5, bw * 0.3 + bl * g.hook * 0.3], ba, base), turn([0, bw], ba, base)]), fill: g.bill ?? 'ink', edge: 0.6 });
  const eye = turn([hr * 0.42, -hr * 0.2], ba, head);
  out.push({ d: circle(eye[0], eye[1], hr * 0.17), fill: 'ink', edge: 0 }, { d: circle(eye[0] - hr * 0.05, eye[1] - hr * 0.06, hr * 0.06), fill: 'pale', edge: 0 });
  return { shapes: out, r: len * 0.85 };
}

/** A snail with a coiled shell, or a slug with a mantle and spots; eye stalks either way. Seen from the side. */
export function snail(rnd, g) {
  const out = [];
  const s = between(rnd, ...g.size), sr = s * 0.5;
  const foot = band([[-s * 0.7, -1], [0, -s * 0.12], [s * (g.shell ? 0.75 : 1.05), -s * 0.08], [s * (g.shell ? 0.95 : 1.3), -s * 0.22]], (t) => s * (0.08 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.3))));
  out.push({ d: closed(foot), fill: g.body, edge: 0.9 });
  const head = [s * (g.shell ? 0.95 : 1.3), -s * 0.24];
  for (const [a, l] of [[-1.0, 0.42], [-0.65, 0.36]]) {
    const end = turn([s * l, 0], a, head);
    out.push({ d: open([head, end]), line: 'ink', w: 0.9 }, { d: circle(end[0], end[1], 1.1), fill: 'ink', edge: 0 });
  }
  if (g.shell) {
    const c = [-s * 0.05, -sr * 1.05];
    out.push({ d: circle(c[0], c[1], sr), fill: g.shell, edge: 1 });
    out.push({ d: open(Array.from({ length: 30 }, (_, i) => turn([sr * 0.92 * (1 - i / 32), 0], (i / 29) * Math.PI * 4.4 + 1.5, c))), line: 'ink', w: 0.8 });
  } else {
    out.push({ d: closed(Array.from({ length: 10 }, (_, i) => [s * 0.45 + s * 0.32 * Math.cos((i / 10) * 6.28), -s * 0.22 + s * 0.12 * Math.sin((i / 10) * 6.28)])), fill: g.body, edge: 0.7 });
    for (let i = 0; i < 6; i++) out.push({ d: circle(between(rnd, -s * 0.5, s * 0.8), -s * between(rnd, 0.1, 0.24), between(rnd, 0.6, 1.3)), fill: 'ink', edge: 0 });
  }
  return { shapes: out, r: s * 0.95 };
}

/** A beetle from above: head, thorax, wing cases with a seam, six jointed legs, antennae, maybe spots. */
export function beetle(rnd, g) {
  const out = [];
  const len = between(rnd, ...g.len), w = len * g.wide;
  for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
    const hip = [s * w * 0.3, -len * (0.45 + k * 0.14)], knee = [s * w * (0.75 + 0.1 * rnd()), hip[1] + k * len * 0.12 - len * 0.04];
    out.push({ d: open([hip, knee, [knee[0] + s * w * 0.18, knee[1] + k * len * 0.16 + len * 0.08]]), line: 'ink', w: 0.8 });
  }
  for (const s of [-1, 1]) out.push({ d: open([[s * w * 0.12, -len * 0.92], [s * w * 0.3, -len * 1.1], [s * w * 0.45, -len * 1.2]]), line: 'ink', w: 0.7 });
  out.push({ d: circle(0, -len * 0.92, w * 0.18), fill: 'ink', edge: 0.6 });
  out.push({ d: closed(Array.from({ length: 10 }, (_, i) => [w * 0.36 * Math.cos((i / 10) * 6.28), -len * 0.76 + len * 0.09 * Math.sin((i / 10) * 6.28)])), fill: g.thorax ?? 'ink', edge: 0.8 });
  out.push({ d: closed(Array.from({ length: 14 }, (_, i) => [w * 0.5 * Math.cos((i / 14) * 6.28), -len * 0.36 + len * 0.36 * Math.sin((i / 14) * 6.28)])), fill: g.shell, edge: 1 });
  out.push({ d: open([[0, -len * 0.66], [0, -len * 0.02]]), line: 'ink', w: 0.7 });
  if (g.spots) for (const [x, y] of [[0.22, 0.25], [-0.22, 0.25], [0.2, 0.5], [-0.2, 0.5]]) out.push({ d: circle(x * w, -y * len, w * 0.08), fill: 'ink', edge: 0 });
  return { shapes: out, r: len * 0.7 };
}
