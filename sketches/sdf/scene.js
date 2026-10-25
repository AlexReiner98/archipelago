// One scene, one field: a branch across the tile, a bird on it, ferns and fungi growing from it, all melted together
// where they touch. The field is sampled once on a grid that wraps; every line drawn is one of its levels: the
// echo lines rippling out into the background, the ink outline, and each part's colour.

import { PLACES } from '../life/places.js';
import { loops } from '../field/contours.js';
import { closed } from '../life/shapes.js';
import { cone, smin } from './sdf.js';
import { bird, fern, fungus } from './species.js';

const W = 280;
const ORDER = ['echo', 'branch', 'frond', 'rib', 'stem', 'cap', 'tail', 'legs', 'body', 'breast', 'cheek', 'crown', 'wing', 'beak', 'eye', 'glint'];
const wrap = (d) => d - W * Math.round(d / W);
const DEFAULT_FUNGUS = { size: [22, 28], stem: 0.8, girth: 1, capW: 0.6, capH: 0.35, cap: 'dome', colour: 'warm' };

/** Where everything stands: instances with a position, a turn, a flip and their parts. */
export function arrange(place, { lift = 14, seed = 1 } = {}) {
  const P = PLACES[place], card = (kind) => P.life.find((l) => l.kind === kind)?.g;
  const y0 = W * 0.48, ph = seed * 1.7;
  const branchY = (x) => y0 + lift * Math.sin((2 * Math.PI * x) / W + ph);
  const things = [];
  const put = (made, x, top, { a = 0, flip = 1 } = {}) => things.push({ ...made, x, y: branchY(x) + (top ? -3 : 3), a, flip });
  put(bird(P.bird), W * 0.3, true, { flip: seed % 2 ? 1 : -1 });
  const fc = card('fern') ?? { len: [55, 70], pairs: [10, 13], pinna: 0.3, wide: 0.22, sweep: 0.3 };
  put(fern(fc, 0.25, 0.85), W * 0.62, true);
  put(fern(fc, -0.2, 0.75), W * 0.86, false, { a: Math.PI });
  const gc = card('mushrooms') ?? DEFAULT_FUNGUS;
  put(fungus(gc, 0.9), W * 0.08, true);
  put(fungus(gc, 0.7), W * 0.47, false, { a: Math.PI, flip: -1 });
  // The branch: segments across the tile, measured across its seam.
  const segs = Array.from({ length: 36 }, (_, i) => {
    const xa = (W * i) / 36, xb = (W * (i + 1)) / 36;
    return [xa, cone(0, branchY(xa), xb - xa, branchY(xb), 3.4, 3.4)];
  });
  const one = (x, y) => {
    let d = Infinity;
    for (const [xa, seg] of segs) d = Math.min(d, seg(wrap(x - xa), y));
    return d;
  };
  // A second row, half a tile across and down, mirrored: the rows' echoes meet between them.
  const copies = things.map((t) => ({ ...t, x: W / 2 - t.x, y: t.y + W / 2, flip: -t.flip, a: -t.a }));
  const branch = (x, y) => Math.min(one(x, y0 + wrap(y - y0)), one(W / 2 - x, y0 + wrap(y - y0 - W / 2)));
  return { P, things: [...things, ...copies], branch };
}

/** The field sampled on an n × n grid that wraps: the scene's distance, and each layer's. */
export function sample({ things, branch }, n, melt = 2.5, reach = 40) {
  const k = W / n, layers = Object.fromEntries(ORDER.map((l) => [l, new Float32Array(n * n).fill(-1e3)]));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * k, y = j * k, at = j * n + i;
    let scene = branch(x, y);
    layers.branch[at] = -scene;
    for (const t of things) {
      let dx = wrap(x - t.x), dy = wrap(y - t.y);
      const far = Math.hypot(dx, dy) - t.R;
      if (far > reach) { scene = Math.min(scene, far); continue; }
      const c = Math.cos(-t.a), s = Math.sin(-t.a);
      [dx, dy] = [(dx * c - dy * s) * t.flip, dx * s + dy * c];
      for (const p of t.parts) {
        const d = p.d(dx, dy);
        scene = smin(scene, d, melt);
        layers[p.layer][at] = Math.max(layers[p.layer][at], -d);
      }
    }
    layers.echo[at] = -scene;
  }
  return layers;
}

/** Which material each layer is painted in: the first part that names it. */
const mats = (things) => Object.fromEntries(things.flatMap((t) => t.parts).reverse().map((p) => [p.layer, p.mat]));

/** The tile as SVG: echo lines, the ink outline, each layer's colour a little off register. */
export function tile(place, { n = 200, rings = 7, gap = 5, print = 0.8, lift = 14, seed = 1 } = {}, id = 't') {
  const t0 = performance.now();
  const scene = arrange(place, { lift, seed });
  // Parts are measured exactly as far out as the echo lines reach; beyond that a bound will do.
  const layers = sample(scene, n, 2.5, rings * gap + 6);
  const t1 = performance.now();
  const pal = scene.P.palette, mat = { branch: 'earth', ...mats(scene.things) };
  const path = (layer, level) => loops({ n, v: layers[layer] }, level, W).map(closed).join('');
  let svg = `<rect width="${W}" height="${W}" fill="${pal.paper}"/>`;
  for (let r = rings; r >= 1; r--) svg += `<path d="${path('echo', -r * gap)}" fill="none" stroke="${pal.cool}" stroke-opacity="${(0.25 + 0.5 * (1 - r / (rings + 1))).toFixed(2)}" stroke-width="0.9"/>`;
  svg += `<path d="${path('echo', -1.3)}" fill="${pal.ink}" fill-rule="evenodd"/>`;
  for (const layer of ORDER.slice(1)) {
    if (!mat[layer]) continue;
    const d = path(layer, 0);
    if (d) svg += `<path d="${d}" fill="${pal[mat[layer]]}" fill-rule="evenodd" transform="translate(${print} ${-print * 0.6})"/>`;
  }
  return { svg, w: W, h: W, fieldMs: t1 - t0, drawMs: performance.now() - t1 };
}
