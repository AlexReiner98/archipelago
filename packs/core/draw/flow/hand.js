// Steps put by hand, set where they were put once everything else stands. Nothing else moves but what hangs on such a
// step; its wires are drawn again from it, at right angles, round the other boxes. Pure: places and wires in, changed in
// place.

import { route, tieRoute } from './free.js';

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * `placed` is the middle of each step put by hand, by item. `rigid` holds what the pull moved as one, by item, each with
 * the items that `hangs` on it; `routes` each link's line, one with no `to` a comb's; `holder` the item a comb's kid hangs
 * from. Answers with the routes drawn again that have a box at both ends, for reroute.
 */
export function putByHand({ placed, nodes, x, y, every, routes, rigid, holder, lead }) {
  const hand = new Set(Object.keys(placed ?? {}).filter((id) => x.has(id) && Array.isArray(placed[id])));
  if (!hand.size) return [];
  for (const id of hand) {
    const [dx, dy] = [Number(placed[id][0]) - x.get(id), Number(placed[id][1]) - y.get(id)], b = rigid.get(id);
    for (const it of [id, ...(b?.hangs ?? []).filter((k) => !hand.has(k))]) (x.set(it, x.get(it) + dx), y.set(it, y.get(it) + dy));
    if (b) ((b.at[0] += dx), (b.at[1] += dy));
    for (const r of routes.values()) if (r.to === undefined && holder(r.from) === id) r.points = r.points.map(([p, q]) => [p + dx, q + dy]);
  }
  const boxOf = (id) => ({ id, x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h }), boxes = [...nodes.keys()].filter((id) => x.has(id)).map(boxOf);
  const drawn = [];
  for (const w of every) {
    if (!hand.has(w.a) && !hand.has(w.b)) continue;
    const k = pair(w.a, w.b), had = routes.get(k);
    // A comb's own wire moved with its holder, unless its kid was put somewhere itself.
    if (had && had.to === undefined && !hand.has(holder(w.a) === w.a ? w.b : w.a) && hand.has(holder(w.a))) continue;
    const from = had?.from ?? w.a, to = from === w.a ? w.b : w.a, others = boxes.filter((b) => b.id !== w.a && b.id !== w.b);
    const r = { from, to, a: from, b: to, points: (w.path ? route : tieRoute)(boxOf(from), boxOf(to), lead, others) };
    routes.set(k, r);
    if (rigid.has(from) && rigid.has(to)) drawn.push(r);
  }
  return drawn;
}
