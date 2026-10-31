// A ridges picture that moves: one field carried from a start to an end by turning the pattern and scale dials while
// it grows (diffusion.js), written as one animated SVG, light enough to keep as a figure on the site.
//
// A picture of its own for each moment would weigh megabytes and shimmer. Here every row is cut into tiles that never
// move: a tile keeps its colour for good, and only the height of its land changes, in the SVG itself, between a few
// key moments. So colours cannot flicker: they belong to the place, not to whichever island happens to stand on it.
// Dials in, an SVG out; no page.

import { archipelagos, growing } from './diffusion.js';
import { landOf, waterOf } from './palettes.js';
import { colourOf, swell } from './paint.js';
import { random, ridges } from './ridges.js';

export const MORPH = {
  fromPattern: 0, toPattern: 1.3,  // spots to coral
  fromScale: 1.2, toScale: 0.1,  // fine to large
  fromLand: 0.2, toLand: 0.9,    // scattered islands to one mass
  keys: 6,        // key moments: more is smoother between them, and heavier
  seconds: 8,     // how long it takes
  wait: 1,        // how long the start holds first
  grow: 1800,     // how far the field grows between two keys
  rows: 64,       // rows of land
  tiles: 12,      // tiles across a row: more colour, more weight
  points: 10,     // points along a tile: finer ridges, more weight
  bands: 2,       // colour bands up each ridge
  shallows: true, // pale water round the land
  outline: false, // an ink line along each ridge
  loop: false,    // back and forth for ever, not once
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
/** Cells across the width at a scale, as the still picture has them. */
const cellsAt = (scale, W) => Math.max(16, (40 + scale * 70) * (W / 800));

/**
 * The field at each key moment, one run of growth with the dials turning, and the places: fixed for the whole run,
 * each cell in the place nearest it, so no island changes palette as it joins another. The grid is the coarsest
 * scale's; a finer scale is the chemicals spreading slower, forms shrinking by the square root.
 */
export function fieldsOf({ morph: m, width: W, height: H, variety, seed, chains }) {
  const coarse = cellsAt(Math.min(m.fromScale, m.toScale), W);
  const nx = Math.round(coarse), ny = Math.round((nx * H) / W);
  const diffuse = (scale) => Math.min(1, (coarse / cellsAt(scale, W)) ** 2);
  const grower = growing({ nx, ny, variety, seed });
  grower.run(3000, m.fromPattern, diffuse(m.fromScale));
  const fields = [grower.field()], parts = 4;
  for (let k = 1; k < m.keys; k++) {
    for (let p = 1; p <= parts; p++) {
      const t = ease((k - 1 + p / parts) / (m.keys - 1));
      grower.run(Math.round(m.grow / parts), lerp(m.fromPattern, m.toPattern, t), diffuse(lerp(m.fromScale, m.toScale, t)));
    }
    fields.push(grower.field());
  }
  const found = archipelagos(fields.at(-1), 0.62 - m.toLand * 0.5, Math.max(1, chains), seed);
  const far = (x, y, c) => Math.hypot(Math.min(Math.abs(x - c.x), nx - Math.abs(x - c.x)), Math.min(Math.abs(y - c.y), ny - Math.abs(y - c.y)));
  const group = Int32Array.from({ length: nx * ny }, (_, i) => {
    const x = i % nx, y = (i - x) / nx;
    return found.centres.reduce((best, c, g) => (far(x, y, c) < far(x, y, found.centres[best]) ? g : best), 0);
  });
  return { fields, arch: { ...found, group, island: new Int32Array(nx * ny).fill(-1), rank: new Float32Array(1).fill(1) } };
}

/** Each row at each key, from the picture's own land, with nothing on it that does not hold still. */
export function keysOf({ dials, morph: m }) {
  const { fields, arch } = fieldsOf({ morph: m, width: dials.width, height: dials.height, variety: dials.variety, seed: dials.seed, chains: dials.chains });
  const key = `morph ${Math.random()}`;
  return fields.map((field, k) => ridges({ ...dials, source: 'diffusion', rows: m.rows, foothills: 0, clouds: 0, hierarchy: 0, land: lerp(m.fromLand, m.toLand, ease(k / (m.keys - 1))), pinned: { key, field, arch } }));
}

const hex = (i) => Math.imul(i, 2654435761) >>> 0;

/** A tile's line as a path's numbers, a whole unit apart: relative, the first letter once, so it packs small. */
function written(points) {
  let d = '', [px, py] = points[0];
  d = `M${px} ${py}l`;
  points.slice(1).forEach(([x, y], k) => {
    const dx = x - px, dy = y - py;
    (px = x), (py = y);
    d += `${k ? ' ' : ''}${dx}${dy < 0 ? '' : ' '}${dy}`;
  });
  return d;
}

/** One animated shape: drawn as its first key, moving through the rest, or plain where it never moves. */
function shape(attrs, keys, m) {
  const seen = new Set(keys);
  if (seen.size === 1) return `<path ${attrs} d="${keys[0]}"/>`;
  const values = m.loop ? [...keys, ...keys.slice(0, -1).reverse()] : keys;
  return `<path ${attrs} d="${keys[0]}"><animate attributeName="d" begin="${m.wait}s" dur="${m.loop ? 2 * m.seconds : m.seconds}s" ${m.loop ? 'repeatCount="indefinite"' : 'fill="freeze"'} values="${values.join(';')}"/></path>`;
}

/** The animated SVG, and what it weighs in shapes. Coordinates are whole units of the page: finer only weighs more. */
export function svgOf({ pics, morph: m, palOf, base, background, weighted = true }) {
  const { width: W, height: H, xs, gap } = pics[0], U = 1;
  const last = pics.at(-1), n = xs.length, tiles = m.tiles, parts = [];
  // Where a row's tiles meet: staggered from row to row, each at the lowest ground near it on the finished land, so a
  // change of colour falls in a valley and never lines up down the page.
  const cuts = pics[0].rows.map((_, r) => {
    const h = last.rows[r].h, wide = (n - 1) / tiles, shift = random(hex(r * 7919 + 3))() * wide;
    return [0, ...Array.from({ length: tiles - 1 }, (_, t) => {
      const near = Math.round((t + 1) * wide - wide / 2 + shift), reach = Math.round(wide * 0.3);
      let low = near;
      for (let i = Math.max(1, near - reach); i <= Math.min(n - 2, near + reach); i++) if (h[i] < h[low]) low = i;
      return low;
    }), n - 1];
  });
  const place = (r, t, q) => Math.round(lerp(cuts[r][t], cuts[r][t + 1], q / m.points));
  let moving = 0;
  const add = (attrs, keys) => {
    moving++;
    parts.push(shape(attrs, keys, m));
  };
  /** A tile standing `rise(pic, r, i)` above its row at each key: nothing where it never rises. */
  const tile = (r, t, fill, rise) => {
    const y = Math.round(pics[0].rows[r].y * U);
    const stands = pics.map((pic) => Array.from({ length: m.points + 1 }, (_, q) => Math.round(rise(pic, r, place(r, t, q)) * U)));
    if (stands.every((list) => list.every((v) => v === 0))) return;
    const keys = stands.map((list) => written([[Math.round(xs[place(r, t, 0)] * U), y], ...list.map((v, q) => [Math.round(xs[place(r, t, q)] * U) + (q === m.points ? 1 : 0), y - v]), [Math.round(xs[place(r, t, m.points)] * U) + 1, y]]));
    add(`fill="${fill}"`, keys);
  };
  for (let r = 0; r < pics[0].rows.length; r++) {
    if (m.shallows)
      for (let t = 0; t < tiles; t++) {
        const g = last.rows[r].groups[place(r, t, m.points >> 1)];
        tile(r, t, waterOf(palOf(g)).shallows[1], (pic, row, i) => (pic.rows[row].shelf[i] > 0.02 ? gap * (0.2 + 0.3 * pic.rows[row].shelf[i]) : 0));
      }
    for (let b = 0; b < m.bands; b++)
      for (let t = 0; t < tiles; t++) {
        const g = last.rows[r].groups[place(r, t, m.points >> 1)];
        const pick = random(hex(r * 4099 + t * 131 + b * 17 + 1))();
        tile(r, t, colourOf(landOf(palOf(g)), Math.floor(pick * 1e6), null, weighted), (pic, row, i) => {
          const { h, steps } = pic.rows[row], rest = h[i] - b * steps[i];
          return rest >= 0.3 ? rest : 0;
        });
      }
    if (m.outline) {
      const line = (pic) => {
        const points = [];
        for (let t = 0; t < tiles; t++) for (let q = t ? 1 : 0; q <= m.points; q++) points.push([Math.round(xs[place(r, t, q)] * U), Math.round((pic.rows[r].y - pic.rows[r].h[place(r, t, q)]) * U)]);
        return written(points);
      };
      parts.push(shape(`stroke="${base.ink}" fill="none"`, pics.map(line), m));
    }
  }
  const floors = pics[0].rows.map(({ y }) => `M${Math.round(xs[0] * U)} ${Math.round(y * U)}h${Math.round((xs[n - 1] - xs[0]) * U)}`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * U} ${H * U}"><rect width="${W * U}" height="${H * U}" fill="${background}"/><path d="${floors}" fill="none" stroke="${swell(base, background)}"/>${parts.join('')}</svg>`;
  return { svg, shapes: moving };
}
