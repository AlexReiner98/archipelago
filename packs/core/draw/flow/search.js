// The best way found to draw one part: a few fixed trials judged before the pull, the slower embedding where they all leave
// wires up, and even rows for a small sparse part. Layer: shape, by what it chooses. Pure: a part in, its drawing out.

import { count } from './count.js';
import { costOf, drawPart } from './part.js';
import { pair } from './polyline.js';
import { tidy } from './tidy.js';

/** The ways a part may be drawn, a fixed order of its ties and which face is outer, the likeliest first: the style says how many. */
const TRIALS = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2]].map(([ties, nth]) => ({ ties, nth }));

/** The links of a part, the order first so it is what stays planar, each as [upper, lower, how firmly]. */
export function linksOf(list, every, ways) {
  const own = new Set(list), done = new Set(), part = [];
  for (const w of [...every].sort((p, q) => Number(q.path !== undefined) - Number(p.path !== undefined))) {
    const k = pair(w.a, w.b);
    if (w.a === w.b || !own.has(w.a) || !own.has(w.b) || done.has(k)) continue;
    done.add(k);
    part.push(ways.has(`${w.a} ${w.b}`) ? [w.a, w.b, ways.get(`${w.a} ${w.b}`)] : ways.has(`${w.b} ${w.a}`) ? [w.b, w.a, ways.get(`${w.b} ${w.a}`)] : [w.a, w.b, 0]);
  }
  return part;
}

/** How one part is drawn, and how many crossings its threading made. `total` is how many items are in the core. */
export function drawnPart(list, part, { block, stepSize, ways, z, even, rowsLinks, total }) {
  let drawn, threaded = 0;
  if (list.length >= 3 && part.length >= 3) {
    for (const trial of list.length <= z.trial_most && total <= z.trial_total ? TRIALS.slice(0, z.trials) : TRIALS.slice(0, 1)) {
      try {
        const made = drawPart(list, part, block, stepSize, z, trial), cost = costOf(made, stepSize, z);
        if (!drawn || cost < drawn.cost) drawn = { ...made, cost };
      } catch (e) { console.warn?.(`The bars fell back: ${e.message}`); }
    }
    // Only where every trial left order wires up is the slower embedding made for the order tried.
    if (drawn?.up && list.length <= z.embed_most) {
      try {
        const made = drawPart(list, part, block, stepSize, z, { embedded: true }), cost = costOf(made, stepSize, z);
        if (cost < drawn.cost) drawn = { ...made, cost };
      } catch (e) { console.warn?.(`The bars fell back: ${e.message}`); }
    }
    if (drawn) threaded = drawn.crossings;
  }
  if (!drawn) {
    let run = 0;
    const first = (p, q) => (ways.has(`${q} ${p}`) ? 1 : ways.has(`${p} ${q}`) ? -1 : 0);
    drawn = { places: new Map([...list].sort(first).map((id) => { const p = [0, run]; run += block(id).h + z.row; return [id, p]; })), points: new Map(), crossings: 0 };
  }
  // A small picture stands in even rows, in the order along each row the planar drawing found.
  if (even && list.length >= 2 && part.length <= list.length * rowsLinks) {
    const from = new Map([...drawn.places].map(([id, [px]]) => [id, px - block(id).w / 2 + stepSize(id).w / 2])), crossed = (d) => count([...d.points.values()].map((r) => r.points)).crossings;
    const neat = tidy(list, part, from, stepSize, block, z);
    // A knot keeps its planar drawing: even rows would cross what that does not.
    if (crossed(neat) <= crossed(drawn) || !drawn.points.size) drawn = neat;
  }
  return { drawn, threaded };
}
