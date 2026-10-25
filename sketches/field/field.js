// The one rule everything grows from: a Gray-Scott reaction-diffusion field on a grid that wraps at every edge,
// so whatever is drawn from it repeats with no seam. Input in, a field out; no page.

import { random } from '../life/shapes.js';

/** The spectrum the pattern dial runs along: dividing spots (0), worms (0.5), coral labyrinth (1). */
export const rates = (t) => ({ feed: 0.0367 + (0.0545 - 0.0367) * t, kill: 0.0649 + (0.062 - 0.0649) * t });

/** v, 0 to 1, on an n × n torus. */
export function grow({ n = 80, pattern = 0.3, steps = 5000, seed = 1 }) {
  const { feed, kill } = rates(pattern), rnd = random(seed * 104729 + 7);
  const size = n * n;
  let u = new Float32Array(size).fill(1), v = new Float32Array(size), u2 = new Float32Array(size), v2 = new Float32Array(size);
  // Seeds: small squares of the second chemical, enough that the field fills fast.
  for (let s = 0; s < 6 + Math.round(n / 4); s++) {
    const cx = Math.floor(rnd() * n), cy = Math.floor(rnd() * n), r = 1 + Math.floor(rnd() * 3);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const i = ((cy + dy + n) % n) * n + ((cx + dx + n) % n);
      (u[i] = 0.5), (v[i] = 0.25 + rnd() * 0.1);
    }
  }
  // Each cell's eight neighbours, wrapped.
  const nb = new Int32Array(size * 8);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const at = (dx, dy) => ((y + dy + n) % n) * n + ((x + dx + n) % n), i = (y * n + x) * 8;
    [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([dx, dy], k) => (nb[i + k] = at(dx, dy)));
  }
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < size; i++) {
      const j = i * 8, ui = u[i], vi = v[i];
      const lu = 0.2 * (u[nb[j]] + u[nb[j + 1]] + u[nb[j + 2]] + u[nb[j + 3]]) + 0.05 * (u[nb[j + 4]] + u[nb[j + 5]] + u[nb[j + 6]] + u[nb[j + 7]]) - ui;
      const lv = 0.2 * (v[nb[j]] + v[nb[j + 1]] + v[nb[j + 2]] + v[nb[j + 3]]) + 0.05 * (v[nb[j + 4]] + v[nb[j + 5]] + v[nb[j + 6]] + v[nb[j + 7]]) - vi;
      const uvv = ui * vi * vi;
      u2[i] = ui + lu - uvv + feed * (1 - ui);
      v2[i] = vi + 0.5 * lv + uvv - (feed + kill) * vi;
    }
    [u, u2] = [u2, u];
    [v, v2] = [v2, v];
  }
  let max = 1e-6;
  for (let i = 0; i < size; i++) max = Math.max(max, v[i]);
  for (let i = 0; i < size; i++) v[i] /= max;
  return { n, v };
}

/** The field at any point, smoothly, wrapping. */
export function sample({ n, v }, x, y) {
  x = ((x % n) + n) % n;
  y = ((y % n) + n) % n;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  return (v[y0 * n + x0] * (1 - fx) + v[y0 * n + x1] * fx) * (1 - fy) + (v[y1 * n + x0] * (1 - fx) + v[y1 * n + x1] * fx) * fy;
}

/** Which way the field rises, at a point. */
export const slope = (f, x, y) => [(sample(f, x + 0.5, y) - sample(f, x - 0.5, y)), (sample(f, x, y + 0.5) - sample(f, x, y - 0.5))];
