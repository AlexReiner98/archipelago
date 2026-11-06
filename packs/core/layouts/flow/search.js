// The best way found to draw one part: a few fixed trials judged before the pull, and the slower embedding where they all
// leave wires up. Layer: shape, by what it chooses. Pure: a part in, its drawing out.

import { costOf, drawPart } from './part.js';
import { FALL, RISE } from './graph.js';
import { pair } from './polyline.js';

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

/** Each two ports on one side that stand the other way round from how their wires come to it at sea (`along`, by id). */
function against(places, along) {
  const on = [...along].filter(([id]) => places.has(id));
  let n = 0;
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const [[p, [ps, pa]], [q, [qs, qa]]] = [on[i], on[j]];
    if (ps === qs && (places.get(p)[0] - places.get(q)[0]) * (pa - qa) < 0) n++;
  }
  return n;
}

/** The ports of a part, a line for each side, in the order their wires come at sea: each next two are held so in its embedding (./thread.js). */
function linedUp(list, along, part) {
  const bySide = new Map(), itemOf = new Map();
  for (const [a, b] of part) for (const [p, q] of [[a, b], [b, a]]) if (along.has(p) && q !== RISE && q !== FALL) itemOf.set(p, q);
  for (const id of list) if (along.has(id)) (bySide.get(along.get(id)[0]) ?? bySide.set(along.get(id)[0], []).get(along.get(id)[0])).push(id);
  // The ports of one item side by side, where its ports come on average: they cannot stand apart without its wires crossing.
  const share = (id) => along.get(id)[1], mean = new Map();
  for (const ids of bySide.values()) for (const id of ids) { const m = mean.get(itemOf.get(id)) ?? [0, 0]; mean.set(itemOf.get(id), [m[0] + share(id), m[1] + 1]); }
  const key = (id) => mean.get(itemOf.get(id))[0] / mean.get(itemOf.get(id))[1];
  return [...bySide.values()].map((ids) => ids.sort((p, q) => key(p) - key(q) || String(itemOf.get(p)).localeCompare(String(itemOf.get(q))) || share(p) - share(q)));
}

/** How one part is drawn. `total` is how many items are in the core; an island's part tries every way, and is judged by its ports' order too. */
export function drawnPart(list, part, { block, stepSize, ways, z, total, along = new Map() }) {
  let drawn;
  if (list.length >= 3 && part.length >= 2) {
    const ported = list.some((id) => along.has(id)), lines = ported ? linedUp(list, along, part) : [];
    // A part with ports tries each way with them held in the sea's order, and each mirrored.
    const trials = ported ? [false, true].flatMap((mirror) => TRIALS.map((t) => ({ ...t, lines, mirror }))) : list.length <= z.trial_most && total <= z.trial_total ? TRIALS.slice(0, z.trials) : TRIALS.slice(0, 1);
    for (const trial of trials) {
      try {
        const made = drawPart(list, part, block, stepSize, z, trial), cost = costOf(made, stepSize, z) + against(made.places, along) * z.cost_cross;
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
  }
  // Two boxes, the one over the other, a wire straight between them.
  if (!drawn) {
    let run = 0;
    const first = (p, q) => (ways.has(`${q} ${p}`) ? 1 : ways.has(`${p} ${q}`) ? -1 : 0), places = new Map([...list].sort(first).map((id) => { const p = [0, run]; run += block(id).h + z.row; return [id, p]; }));
    const portOf = (id, way) => places.get(id)[1] + block(id).lead + (way > 0 ? stepSize(id).h : 0);
    const points = new Map(part.map(([p, q]) => {
      const [upper, lower] = places.get(p)[1] < places.get(q)[1] ? [p, q] : [q, p], [from, to] = [[0, portOf(upper, 1)], [0, portOf(lower, -1)]];
      return [pair(p, q), { from: p, to: q, points: upper === p ? [from, to] : [to, from] }];
    }));
    drawn = { places, points, crossings: 0 };
  }
  return drawn;
}
