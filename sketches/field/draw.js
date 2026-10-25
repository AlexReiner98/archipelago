// One field, three species, one tile: moss in the gaps, the lichen's body in three printed levels, cups on its peaks.

import { PLACES } from '../life/places.js';
import { grow } from './field.js';
import { levelPath } from './contours.js';
import { peaks, cups, moss } from './grow.js';

// How each place colours the three, by palette role: lichen levels (halo, body, core), cup rim and disc.
export const LOOKS = {
  faroe: { lichen: ['pale', 'cool', 'leaf2'], cupRim: 'warm', disc: 'earth' },
  galapagos: { lichen: ['pale', 'accent', 'warm'], cupRim: 'warm', disc: 'earth' },
  rajaAmpat: { lichen: ['pale', 'cool', 'leaf2'], cupRim: 'accent', disc: 'warm' },
  haidaGwaii: { lichen: ['pale', 'leaf2', 'leaf'], cupRim: 'warm', disc: 'earth' },
};
const LEVELS = [0.18, 0.32, 0.7];
const W = 320;

let cache = { key: '' };
/** The field for these dials, grown once and kept while they hold. */
function fieldFor(n, pattern, seed) {
  const key = `${n}|${pattern}|${seed}`;
  if (cache.key !== key) {
    const t0 = performance.now();
    cache = { key, field: grow({ n, pattern, seed }), ms: performance.now() - t0 };
  }
  return cache;
}

const f = (v) => +v.toFixed(2);
function paint(shapes, pal, mis) {
  return shapes
    .map((s) =>
      s.line
        ? `<path d="${s.d}" fill="none" stroke="${pal[s.line]}" stroke-width="${s.w}" stroke-linecap="round"/>`
        : (s.edge ? `<path d="${s.d}" fill="${pal.ink}" stroke="${pal.ink}" stroke-width="${f(s.edge * 2)}" stroke-linejoin="round"/>` : '') +
          `<path d="${s.d}" fill="${pal[s.fill]}"${s.edge ? ` transform="translate(${mis} ${-mis * 0.6})"` : ''}/>`,
    )
    .join('');
}

/** The tile as an SVG <pattern>'s inside, with what it took. */
export function tile({ place, pattern = 0.3, scale = 0.4, growth = 0.6, cup = 0.5, seed = 1, print = 0.8 }, id = 't') {
  const pal = PLACES[place].palette, look = { ...LOOKS[place], cup, moss: growth, reach: 40, every: 3, leaf: 4.2, wide: 0.26, stem: 0.9 };
  const n = Math.round(48 + scale * 72);
  const grown = fieldFor(n, pattern, seed), field = grown.field, k = W / n;
  const t0 = performance.now();
  const [halo, body, core] = LEVELS.map((t) => levelPath(field, t, W));
  const life = [...moss(field, LEVELS[0], k, look, seed), ...cups(field, peaks(field, 0.75, LEVELS[1]), k, look)];
  const ring = [-W, 0, W].flatMap((dx) => [-W, 0, W].map((dy) => `<use href="#${id}-life" transform="translate(${dx} ${dy})"/>`)).join('');
  const lichen =
    `<path d="${halo}" fill="${pal[look.lichen[0]]}" fill-rule="evenodd"/>` +
    `<path d="${body}" fill="${pal.ink}" stroke="${pal.ink}" stroke-width="1.6" stroke-linejoin="round" fill-rule="evenodd"/>` +
    `<path d="${body}" fill="${pal[look.lichen[1]]}" fill-rule="evenodd" transform="translate(${print} ${-print * 0.6})"/>` +
    `<path d="${core}" fill="${pal[look.lichen[2]]}" fill-rule="evenodd" transform="translate(${print} ${-print * 0.6})"/>`;
  const svg = `<defs><g id="${id}-life">${paint(life, pal, print)}</g></defs><rect width="${W}" height="${W}" fill="${pal.paper}"/>${lichen}${ring}`;
  return { svg, w: W, h: W, n, fieldMs: grown.ms, drawMs: performance.now() - t0, parts: life.length };
}
