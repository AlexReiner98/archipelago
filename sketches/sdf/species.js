// Species as distance fields: each a few primitives melted together, from the species cards in ../life/places.js.
// Each answers { R, parts: [{ layer, mat, d }] }: d in its own frame (y down, base at the origin), mat a palette role,
// layer where it is drawn among all others.

import { circle, ellipse, cone, half, melt, both } from './sdf.js';

const mid = ([lo, hi]) => (lo + hi) / 2;
const bez = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];

/** A perched bird, facing +x, feet at the origin. */
export function bird(c, grow = 1.5) {
  const L = mid(c.len) * grow, rx = L / 2, ry = L * 0.3, tilt = -0.35;
  const B = [0, -(ry + c.legs * L + 0.1 * L)];
  const at = (x, y) => [B[0] + x * Math.cos(tilt) - y * Math.sin(tilt), B[1] + x * Math.sin(tilt) + y * Math.cos(tilt)];
  const body = ellipse(...B, rx, ry, tilt);
  const H = at(rx * 0.8, -ry * 0.75), hr = ry * c.head * 0.85, head = circle(...H, hr);
  const rear = at(-rx * 0.85, -ry * 0.05), ta = Math.PI + tilt + c.tailUp, tl = L * c.tail;
  const ba = tilt * 0.4, base = [H[0] + Math.cos(ba) * hr * 0.85, H[1] + Math.sin(ba) * hr * 0.85];
  const tip = [base[0] + Math.cos(ba + c.hook) * L * c.beak, base[1] + Math.sin(ba + c.hook) * L * c.beak];
  const eye = [H[0] + hr * 0.38, H[1] - hr * 0.22];
  const parts = [
    { layer: 'tail', mat: c.wing, d: cone(...rear, rear[0] + Math.cos(ta) * tl, rear[1] + Math.sin(ta) * tl, 0.1 * L, 0.1 * L * (1 + c.fan * 3)) },
    ...[-1, 1].map((s) => ({ layer: 'legs', mat: 'ink', d: melt(0.6, cone(...at(s * rx * 0.12, ry * 0.85), s * 2.5, 0, 1.1, 0.8), cone(s * 2.5 - 3, 0, s * 2.5 + 3.5, 0, 0.7, 0.7)) })),
    { layer: 'body', mat: c.body, d: melt(0.12 * L, body, head) },
    c.breast && { layer: 'breast', mat: c.breast, d: both(ellipse(...at(rx * 0.35, ry * 0.3), rx * 0.62, ry * 0.72, tilt), body) },
    c.cheek && { layer: 'cheek', mat: c.cheek, d: both(ellipse(H[0] - hr * 0.05, H[1] + hr * 0.38, hr * 0.55, hr * 0.34, -0.2), head) },
    c.cap && { layer: 'crown', mat: c.cap, d: both(head, half(H[0], H[1] - hr * 0.05, 0.28, 0.96)) },
    { layer: 'wing', mat: c.wing, d: ellipse(...at(-rx * 0.12, -ry * 0.12), rx * 0.86, ry * 0.5, tilt + 0.14) },
    { layer: 'beak', mat: c.bill ?? 'ink', d: cone(...base, ...tip, hr * c.thick * 0.85, 0.5) },
    { layer: 'eye', mat: 'ink', d: circle(...eye, Math.max(1.3, hr * 0.2)) },
    { layer: 'glint', mat: 'pale', d: circle(eye[0] - hr * 0.06, eye[1] - hr * 0.07, Math.max(0.55, hr * 0.07)) },
  ].filter(Boolean);
  return { R: L * 1.1, parts };
}

/** A fern frond, upright from the origin: a stem and paired leaflets melted into one silhouette. */
export function fern(c, lean = 0.2, grow = 1) {
  const L = mid(c.len) * grow, a = [0, 0], cc = [lean * L * 0.6, -L * 0.6], b = [lean * L, -L];
  const pairs = Math.round(mid(c.pairs)), leaves = [];
  for (let i = 0; i < pairs; i++) {
    const t = 0.1 + (0.86 * i) / pairs, p = bez(a, cc, b, t), q = bez(a, cc, b, t + 0.02);
    const up = Math.atan2(q[1] - p[1], q[0] - p[0]), len = L * c.pinna * Math.sin(Math.PI * (0.15 + t * 0.85)) ** 0.7 * (1 - t * 0.35);
    for (const s of [1, -1]) {
      const ang = up + s * (Math.PI / 2 - c.sweep);
      leaves.push(ellipse(p[0] + (Math.cos(ang) * len) / 2, p[1] + (Math.sin(ang) * len) / 2, len / 2, Math.max(1.1, Math.min((len * c.wide) / 2, (L * 0.86) / pairs / 2.6)), ang));
    }
  }
  const pts = Array.from({ length: 9 }, (_, i) => bez(a, cc, b, i / 8));
  const stem = melt(0.5, ...pts.slice(1).map((p, i) => cone(...pts[i], ...p, 1.5 - i * 0.12, 1.4 - i * 0.12)));
  return { R: L * 0.75, parts: [{ layer: 'frond', mat: 'leaf', d: melt(0.6, stem, ...leaves) }, { layer: 'rib', mat: 'leaf2', d: melt(0.4, ...pts.slice(1).map((p, i) => cone(...pts[i], ...p, 0.6, 0.45))) }] };
}

/** A pair of mushrooms, from the origin: cap by kind (dome, cone, flat, funnel), stem below. */
export function fungus(c, grow = 1) {
  const s = mid(c.size) * grow, caps = [], stems = [];
  for (const [x, k] of [[0, 1], [s * 0.42, 0.65]]) {
    const sh = s * c.stem * k, sw = s * 0.1 * c.girth * k, cw = s * c.capW * k, ch = s * c.capH * k;
    stems.push(cone(x, 0, x, -sh, sw * 1.25, sw));
    caps.push(
      c.cap === 'cone' ? melt(1, cone(x, -sh - ch, x, -sh, 0.8, cw / 2), both(ellipse(x, -sh, cw / 2, ch * 0.18), half(x, -sh, 0, -1))) :
      c.cap === 'funnel' ? cone(x, -sh * 0.55, x, -sh - ch * 0.3, sw, cw / 2) :
      both(ellipse(x, -sh, cw / 2, c.cap === 'flat' ? ch * 0.55 : ch), half(x, -sh + ch * 0.12, 0, 1)),
    );
  }
  return { R: s * 1.1, parts: [{ layer: 'stem', mat: c.cap === 'funnel' ? c.colour : 'pale', d: melt(0.8, ...stems) }, { layer: 'cap', mat: c.colour, d: melt(1.2, ...caps) }] };
}
