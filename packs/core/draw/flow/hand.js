// Steps put by hand, set where they were put once everything else stands. Nothing else moves but what hangs on such a
// step. Its wires, and any wire it now stands on, are drawn again by the same logic as the rest: from the side facing where
// they go, with the same spacing, round every box. Pure: places and wires in, changed in place.

import { spreadPorts } from './centre.js';
import { route, tieRoute } from './free.js';
import { rewire } from './reroute.js';

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Whether a line runs through a box. */
const through = (points, { x, y, w, h }) => points.some((p, i) => {
  if (!i) return false;
  const q = points[i - 1];
  return Math.max(p[0], q[0]) > x - w / 2 + 1 && Math.min(p[0], q[0]) < x + w / 2 - 1 && Math.max(p[1], q[1]) > y - h / 2 + 1 && Math.min(p[1], q[1]) < y + h / 2 - 1;
});

/**
 * `placed` is the middle of each step put by hand, by item. `rigid` holds what the pull moved as one, by item, each with
 * the items that `hangs` on it; `routes` each link's line, one with no `to` a comb's; `holder` the item a comb's kid hangs
 * from. `wiring` is what reroute takes.
 */
export function putByHand({ placed, nodes, x, y, every, routes, rigid, holder, lead, wiring }) {
  const hand = new Set(Object.keys(placed ?? {}).filter((id) => x.has(id) && Array.isArray(placed[id])));
  if (!hand.size) return;
  for (const id of hand) {
    const [dx, dy] = [Number(placed[id][0]) - x.get(id), Number(placed[id][1]) - y.get(id)], b = rigid.get(id);
    for (const it of [id, ...(b?.hangs ?? []).filter((k) => !hand.has(k))]) (x.set(it, x.get(it) + dx), y.set(it, y.get(it) + dy));
    if (b) ((b.at[0] += dx), (b.at[1] += dy));
    for (const r of routes.values()) if (r.to === undefined && holder(r.from) === id) r.points = r.points.map(([p, q]) => [p + dx, q + dy]);
  }
  const boxOf = (id) => ({ id, x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h }), boxes = [...nodes.keys()].filter((id) => x.has(id)).map(boxOf);
  const stand = (id) => { if (!rigid.has(id)) rigid.set(id, { at: [x.get(id), y.get(id)], size: [nodes.get(id).w, nodes.get(id).h], hangs: [] }); };
  const drawn = new Set();
  for (const w of every) {
    const k = pair(w.a, w.b), had = routes.get(k);
    // A comb's own wire moved with its holder, unless its kid was put somewhere itself.
    const carried = had && had.to === undefined && !hand.has(holder(w.a) === w.a ? w.b : w.a) && hand.has(holder(w.a));
    if (hand.has(w.a) || hand.has(w.b) ? carried : !had || had.to === undefined || ![...hand].some((id) => through(had.points, boxOf(id)))) continue;
    const from = had?.from ?? w.a, to = from === w.a ? w.b : w.a, others = boxes.filter((b) => b.id !== w.a && b.id !== w.b);
    const r = { ...had, from, to, a: from, b: to, points: (w.path ? route : tieRoute)(boxOf(from), boxOf(to), lead, others) };
    routes.set(k, r);
    stand(from);
    stand(to);
    drawn.add(r);
  }
  const moved = [...drawn], still = [...routes.values()].filter((r) => !drawn.has(r)).map((r) => r.points);
  rewire(rigid, moved, still, wiring);
  spreadPorts(rigid, moved, still, wiring);
}
