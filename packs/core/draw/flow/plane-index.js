// A lens answer on one plane, the flow's picture with another layout: the same steps, wires, hovers and ghosts, placed by
// ./layout.js. Every wire is drawn all the time, those the canvas keeps for hover too: the layout places them all, so a
// wire left out of the picture hides what placed it. The key says how they cross, counted from those wires (./count.js).

import { picture as flow } from './flow.js';
import { count } from './count.js';
import { latest } from './layout.js';
import { m } from './marks.js';

/** Whether a wire runs against the way it has to go overall, for a stretch. */
const doublesBack = (p) => {
  const dy = p.at(-1)[1] - p[0][1], dx = p.at(-1)[0] - p[0][0];
  return p.some((q, i) => i && ((q[1] - p[i - 1][1]) * Math.sign(dy) < -1 || (q[0] - p[i - 1][0]) * Math.sign(dx) < -1));
};

export function picture(input, tools) {
  const out = flow({ ...input, style: { ...input.style, hover_only: [] } }, tools), g = latest();
  if (!g || !out.scene?.key) return out;
  const drawn = [...g.chains, ...g.ties].map((w) => w.points);
  const { crossings, seen, shared } = count(drawn);
  const flowShows = [...g.chains, ...g.ties.filter((t) => t.type !== 'part_of' && t.type !== 'owned_by')].map((w) => w.points);
  const shown = count(flowShows), up = g.chains.filter((w) => w.up).length;
  out.scene.key.push({ glyph: m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, m('path', { d: 'M1 1L21 13M1 13L21 1', class: 'lf-wire' })), label: `${crossings} crossings, ${seen} seen, ${shared} shared, ${drawn.filter(doublesBack).length} double back; without part_of ${shown.crossings} crossings, ${shown.shared} shared, ${flowShows.filter(doublesBack).length} double back; ${up} up; ${Math.round(g.width)} by ${Math.round(g.height)}` });
  return out;
}
