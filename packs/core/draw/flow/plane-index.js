// A lens answer on one plane, the flow's picture with another layout: the same steps, wires, hovers and ghosts, placed by
// ./layout.js. Every wire is drawn all the time, those the canvas keeps for hover too: the layout places them all, so a
// wire left out of the picture hides what placed it. The key says how they cross, counted from those wires (./count.js).

import { picture as flow } from './flow.js';
import { count } from './count.js';
import { shownOnly } from './graph.js';
import { latest } from './layout.js';
import { m } from './marks.js';

export function picture(input, tools) {
  const out = flow({ ...input, answer: shownOnly(input.answer), style: { ...input.style, hover_only: [] } }, tools), g = latest();
  if (!g || !out.scene?.key) return out;
  const drawn = [...g.chains, ...g.ties].map((w) => w.points);
  const { crossings, seen, shared } = count(drawn);
  const glyph = () => m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, m('path', { d: 'M1 1L21 13M1 13L21 1', class: 'lf-wire' }));
  out.scene.key.push(...[`${crossings} crossings`, `${seen} seen`, `${shared} shared`, `${g.up} of ${g.headed ?? g.chains.length} up`].map((label) => ({ glyph: glyph(), label })));
  return out;
}
