// The two species that live off the lichen's field: fruiting cups where it peaks, and a moss that threads the gaps
// along the field's level lines, its leaves as long as the room it is given. Grid units in, tile units out.

import { random, closed, open, circle, leaf } from '../life/shapes.js';
import { sample, slope } from './field.js';

/** The field's peaks above `over`, kept apart, each with how far the body reaches round it (the cup's size). */
export function peaks(f, over, edge) {
  const { n, v } = f, found = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = v[y * n + x];
    if (c < over) continue;
    let top = true;
    for (let dy = -1; dy <= 1 && top; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && v[((y + dy + n) % n) * n + ((x + dx + n) % n)] > c) top = false;
    if (!top) continue;
    // Reach: the nearest the field falls below the body's edge, looking eight ways.
    let reach = Infinity;
    for (let a = 0; a < 8; a++) {
      let r = 0;
      while (r < n / 4 && sample(f, x + Math.cos((a * Math.PI) / 4) * r, y + Math.sin((a * Math.PI) / 4) * r) > edge) r += 0.25;
      reach = Math.min(reach, r);
    }
    found.push({ x, y, v: c, reach });
  }
  found.sort((a, b) => b.v - a.v);
  const kept = [];
  const apart = (a, b) => Math.hypot(Math.min(Math.abs(a.x - b.x), n - Math.abs(a.x - b.x)), Math.min(Math.abs(a.y - b.y), n - Math.abs(a.y - b.y)));
  for (const p of found) if (kept.every((k) => apart(k, p) > Math.max(2.5, (k.reach + p.reach) * 0.9))) kept.push(p);
  return kept;
}

/** Cups: a rim, a disc and a glint, sized by reach. */
export function cups(f, list, k, look) {
  const out = [];
  for (const { x, y, reach } of list) {
    const r = Math.max(0.8, reach * look.cup) * k, cx = x * k, cy = y * k;
    out.push({ d: circle(cx, cy, r), fill: look.cupRim, edge: 0.8 }, { d: circle(cx, cy, r * 0.62), fill: look.disc, edge: 0 }, { d: circle(cx - r * 0.3, cy - r * 0.3, r * 0.16), fill: 'pale', edge: 0 });
  }
  return out;
}

/** Moss: stems along the field's level lines in the gaps, leaves leaning toward the lichen, each as long as the gap. */
export function moss(f, low, k, look, seed) {
  const { n } = f, rnd = random(seed * 31337 + 5), out = [];
  const taken = new Uint8Array(4 * n * n), cell = (x, y) => ((((Math.floor(y * 2) % (2 * n)) + 2 * n) % (2 * n)) * 2 * n + (((Math.floor(x * 2) % (2 * n)) + 2 * n) % (2 * n)));
  const tries = Math.round(n * n * look.moss * 0.05);
  for (let s = 0; s < tries; s++) {
    let x = rnd() * n, y = rnd() * n;
    if (sample(f, x, y) > low * 0.6 || taken[cell(x, y)]) continue;
    // Walk both ways along the level line from the seed.
    const line = [];
    for (const dir of [1, -1]) {
      let px = x, py = y;
      const half = [];
      for (let i = 0; i < look.reach; i++) {
        const [gx, gy] = slope(f, px, py), g = Math.hypot(gx, gy) || 1;
        px += (-gy / g) * dir * 0.5;
        py += (gx / g) * dir * 0.5;
        if (sample(f, px, py) > low || taken[cell(px, py)]) break;
        half.push([px, py]);
      }
      dir === 1 ? line.push(...half.reverse(), [x, y]) : line.push(...half);
    }
    if (line.length < 6) continue;
    for (const [px, py] of line) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) taken[cell(px + dx * 0.5, py + dy * 0.5)] = 1;
    out.push({ d: open(line.filter((_, i) => i % 2 === 0 || i === line.length - 1).map(([a, b]) => [a * k, b * k])), line: 'leaf', w: look.stem });
    // Leaves every few steps, alternate sides, leaning toward the lichen and as long as the room there.
    line.forEach(([px, py], i) => {
      if (i % look.every) return;
      const [gx, gy] = slope(f, px, py), g = Math.hypot(gx, gy) || 1, room = Math.max(0, low - sample(f, px, py)) / low;
      const side = (i / look.every) % 2 ? 1 : -1, [ux, uy] = [gx / g, gy / g], [tx, ty] = [-uy * side, ux * side];
      const a = Math.atan2(0.6 * uy + 0.5 * ty, 0.6 * ux + 0.5 * tx);
      const len = (0.6 + room * look.leaf) * k;
      out.push({ d: closed(leaf([px * k, py * k], a, len, len * look.wide, { n: 6, round: 0.7 })), fill: side > 0 ? 'leaf' : 'leaf2', edge: 0.5 });
    });
  }
  return out;
}
