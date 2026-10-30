// A lens answer on one plane, the flow's picture with another layout: the same steps, wires, hovers and ghosts, placed by
// ./layout.js. The key says how the wires it draws cross, counted from those wires (./count.js), leaving out what the
// style draws only on hover.

import { picture as flow } from './flow.js';
import { count } from './count.js';
import { latest } from './layout.js';
import { m } from './marks.js';

export function picture(input, tools) {
  const out = flow(input, tools), g = latest();
  if (!g || !out.scene?.key) return out;
  const hover = new Set(Array.isArray(input.style.hover_only) ? input.style.hover_only : []);
  const drawn = [...g.chains, ...g.ties.filter((t) => !hover.has(t.type) || t.pending)].map((w) => w.points);
  const { crossings, seen, shared } = count(drawn);
  out.scene.key.push({ glyph: m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, m('path', { d: 'M1 1L21 13M1 13L21 1', class: 'lf-wire' })), label: `${crossings} crossings, ${seen} seen, ${shared} shared` });
  return out;
}
