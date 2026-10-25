// A repeating tile of a place's life: a branch with its birds, plants standing upright where there is room,
// small things in the gaps. Then drawn as a print: an ink silhouette under each colour, the colour a little
// off register. Input in, SVG out; no page.

import { random, between, closed, band } from './shapes.js';
import { fern, moss, mushrooms, sprig, filler } from './plants.js';
import { bird, snail, beetle } from './animals.js';
import { PLACES } from './places.js';

const KINDS = { fern, moss, mushrooms, sprig, filler, snail, beetle, bird };
const UPRIGHT = new Set(['fern', 'moss', 'mushrooms', 'sprig', 'snail', 'bird']);
const W = 320, H = 320, GROW = 1.4;
const f = (v) => +v.toFixed(2);

const weighted = (rnd, list) => {
  let n = rnd() * list.reduce((s, x) => s + x.weight, 0);
  return list.find((x) => (n -= x.weight) < 0) ?? list[0];
};

/** The tile: { w, h, palette, items: [{ shapes, x, y, a, s, flip, r }] }, in draw order. */
export function compose({ place, seed = 1, density = 0.5, wild = 0.5 }) {
  const P = PLACES[place], rnd = random(seed * 7919 + 13);
  const make = (kind, g) => KINDS[kind](rnd, g);

  // The branch: a wave that repeats across the tile, so it runs on through every copy.
  const y0 = between(rnd, H * 0.22, H * 0.42), amp = between(rnd, 8, 22), ph = rnd() * 6.28;
  const branchY = (x) => y0 + amp * Math.sin((2 * Math.PI * x) / W + ph);
  const slope = (x) => Math.atan(((amp * 2 * Math.PI) / W) * Math.cos((2 * Math.PI * x) / W + ph));
  const line = Array.from({ length: 19 }, (_, i) => [-30 + ((W + 60) * i) / 18, branchY(-30 + ((W + 60) * i) / 18)]);
  // Bark: a few short ink strokes along it, and a lichen spot here and there.
  const bark = [];
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = branchY(x) + (rnd() - 0.5) * 2.4, a = slope(x), l = between(rnd, 3, 8);
    bark.push({ d: `M${f(x)} ${f(y)}l${f(Math.cos(a) * l)} ${f(Math.sin(a) * l)}`, line: 'ink', w: 0.5 });
    if (rnd() < 0.2) bark.push({ d: closed(Array.from({ length: 6 }, (_, k) => [x + Math.cos(k) * between(rnd, 1.5, 3), branchY(x) - 2 + Math.sin(k) * between(rnd, 1, 2)])), fill: 'leaf2', edge: 0.4 });
  }
  const branch = { shapes: [{ d: closed(band(line, () => 2.8)), fill: 'earth', edge: 0.9 }, ...bark], x: 0, y: 0, a: 0, s: 1, flip: 1, r: 0, fixed: true };

  const twigs = [], birds = [];
  for (let i = 0, n = 2 + Math.round(density * 3); i < n; i++) {
    const x = (W * (i + rnd() * 0.6)) / n, hang = rnd() < 0.45;
    const t = make('sprig', { len: [22, 38], leaves: [3, 5], leaf: 0.32, wide: 0.32, stem: 'earth' });
    twigs.push({ ...t, x, y: branchY(x), a: (hang ? Math.PI : 0) + (rnd() - 0.5) * 0.7, s: GROW * 0.9, flip: 1 });
  }
  for (let i = 0, n = density > 0.55 ? 2 : 1; i < n; i++) {
    const x = W * (0.2 + 0.55 * i + rnd() * 0.25), b = make('bird', P.bird);
    birds.push({ ...b, x, y: branchY(x) - 2.2, a: slope(x) * 0.6, s: GROW, flip: rnd() < 0.5 ? -1 : 1 });
  }

  // Life on the ground and in the air: placed largest first, each keeping its distance, across the seams too.
  const placed = [];
  const centre = (it) => (UPRIGHT.has(it.kind) ? [it.x + Math.sin(it.a) * it.r * 0.7 * it.s, it.y - Math.cos(it.a) * it.r * 0.7 * it.s] : [it.x, it.y]);
  const torus = (a, b) => Math.hypot(Math.min(Math.abs(a[0] - b[0]), W - Math.abs(a[0] - b[0])), Math.min(Math.abs(a[1] - b[1]), H - Math.abs(a[1] - b[1])));
  const gap = 0.88 - density * 0.33;
  const birdSpots = birds.map((b) => [b.x, b.y - b.r * 0.6 * b.s]);
  for (const [want, pool] of [[Math.round(7 + density * 12), P.life.filter((l) => l.kind !== 'filler')], [Math.round(14 + density * 40), P.life.filter((l) => l.kind === 'filler')]]) {
    for (let tries = 0, got = 0; tries < 600 && got < want; tries++) {
      const sp = weighted(rnd, pool), made = make(sp.kind, sp.g);
      const it = { ...made, kind: sp.kind, x: rnd() * W, y: rnd() * H, s: GROW * between(rnd, 1 - 0.3 * wild, 1 + 0.15 * wild), flip: rnd() < 0.5 ? -1 : 1 };
      it.a = UPRIGHT.has(sp.kind) || made.upright ? (rnd() - 0.5) * 0.5 * (0.3 + wild) : rnd() * 6.28;
      const c = centre(it), R = it.r * it.s;
      const clearOfBranch = Math.abs(c[1] - branchY(c[0])) > R * 0.8 + 5 && Math.abs(c[1] - H - branchY(c[0])) > R * 0.8 + 5 && Math.abs(c[1] + H - branchY(c[0])) > R * 0.8 + 5;
      const clear = placed.every((o) => torus(c, centre(o)) > (R + o.r * o.s) * gap) && birdSpots.every((p) => torus(c, p) > R + 20);
      if (clearOfBranch && clear) placed.push(it), got++;
    }
  }
  const ground = placed.filter((it) => it.kind === 'filler').concat(placed.filter((it) => it.kind !== 'filler').sort((p, q) => p.y - q.y));
  return { w: W, h: H, palette: P.palette, items: [...ground, branch, ...twigs, ...birds] };
}

/** One item as SVG: per shape, its ink silhouette, then its colour off register by mis; ink lines in place. */
function paint(shapes, pal, mis) {
  return shapes
    .map((s) =>
      s.line
        ? `<path d="${s.d}" fill="none" stroke="${pal[s.line]}" stroke-width="${s.w}" stroke-linecap="round" stroke-linejoin="round"/>`
        : (s.edge ? `<path d="${s.d}" fill="${pal.ink}" stroke="${pal.ink}" stroke-width="${f(s.edge * 2)}" stroke-linejoin="round"/>` : '') +
          `<path d="${s.d}" fill="${pal[s.fill] ?? s.fill}"${s.edge ? ` transform="translate(${mis} ${-mis * 0.6})"` : ''}/>`,
    )
    .join('');
}

/** The tile as an SVG <pattern>'s inside: each item once, placed wherever it reaches into the tile. */
export function svgTile({ w, h, palette, items }, id = 't', mis = 0.8) {
  let defs = '', uses = '';
  items.forEach((it, i) => {
    const ref = `${id}-${i}`;
    defs += `<g id="${ref}">${paint(it.shapes, palette, mis)}</g>`;
    const T = `rotate(${f((it.a * 180) / Math.PI)}) scale(${f(it.flip * it.s)} ${f(it.s)})`;
    if (it.fixed) return (uses += `<use href="#${ref}"/>`);
    const R = it.r * it.s * 1.5;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      const x = it.x + dx, y = it.y + dy;
      if (x < -R || x > w + R || y < -R - it.r || y > h + R) continue;
      uses += `<use href="#${ref}" transform="translate(${f(x)} ${f(y)}) ${T}"/>`;
    }
  });
  return `<defs>${defs}</defs><rect width="${w}" height="${h}" fill="${palette.paper}"/>${uses}`;
}
