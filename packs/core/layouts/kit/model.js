// The graph every flow layout starts from (the kit, task e_7v52ek3c): each item a step sized as the flow sizes it
// (./steps.js), the order's wires (`chains`, from what is depended on to what depends on it) and every other link a tie,
// and one order of all the steps, read from the way each link runs (./direction.js), ties and rings broken by when each
// was made. A layout places from this; nothing here is a place. Layer: graph. Pure: the layout's args in, the graph out.

import { directions } from './direction.js';
import { flatten, isOf, ORDER } from './graph.js';
import { stepsOf } from './steps.js';

/**
 * `ids` in an order that keeps every way in `ways` (`${upper} ${lower}`). Of what is free to go next, what is linked
 * (`near`, id to its neighbours) to the step placed last goes first, so linked steps stand together; then the one
 * made first (`made`). A ring is broken at what was made first of what is left.
 */
export function sorted(ids, ways, made, near = new Map()) {
  const before = new Map(ids.map((id) => [id, 0])), after = new Map(ids.map((id) => [id, []]));
  for (const key of ways.keys()) {
    const [a, b] = key.split(' ');
    if (!before.has(a) || !before.has(b) || a === b) continue;
    after.get(a).push(b);
    before.set(b, before.get(b) + 1);
  }
  const placed = new Map(), out = [];
  // How lately a neighbour of `id` was placed: the later, the nearer it should stand.
  const lately = (id) => Math.max(-1, ...[...(near.get(id) ?? [])].map((o) => placed.get(o) ?? -1));
  const better = (p, q) => lately(p) - lately(q) || made(q) - made(p);
  let ready = ids.filter((id) => before.get(id) === 0);
  const left = [...ids].sort((p, q) => made(p) - made(q));
  while (out.length < ids.length) {
    // A ring: the first made of what is left goes next, as if what it waits on were placed.
    if (!ready.length) ready = [left.find((id) => !placed.has(id))];
    const id = ready.reduce((b, c) => (better(c, b) > 0 ? c : b));
    ready = ready.filter((r) => r !== id);
    placed.set(id, out.length);
    out.push(id);
    for (const b of after.get(id)) {
      before.set(b, before.get(b) - 1);
      if (before.get(b) === 0 && !placed.has(b)) ready.push(b);
    }
  }
  return out;
}

/**
 * The graph of the layout's args (as the flow's layout is given them): `nodes` (id to step: id, item, shape, w, h,
 * lines, line, bevel, stub, made), `chains` ({ a, b, dashed, says, pending }), `ties` ({ a, b, type, flipped,
 * pending }), `potential`, `order` (every id, top first) with `rank` (id to its place in it), and `against(w)`: whether
 * a wire runs up the order, from what should stand under to what should stand over.
 */
export function model({ items: asked, links: linked = [], undrawn = [], headless = ['part_of'], measure, sizes, shapes = {} }) {
  const { items, links } = flatten({ items: asked, links: linked, undrawn });
  const { nodes, edges, potential } = stepsOf({ items, links, measure, sizes, shapes });
  // A link from an item to an actor (waits on, owned by) runs from the actor, as the flow draws it (./layout.js).
  const actor = new Set(items.filter((i) => isOf(i, 'actor')).map((i) => i.id));
  const toActor = (l) => actor.has(l.to) && !actor.has(l.from);
  const chains = edges.map((e) => ({ ...e, dashed: potential.has(e.b) }));
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ ...(toActor(l) ? { a: l.to, b: l.from, flipped: true } : { a: l.from, b: l.to }), type: l.type, ...(l.pending && { pending: l.pending }) }));
  const ways = directions(chains, ties, headless);
  const made = (id) => nodes.get(id).made;
  const near = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const w of [...chains, ...ties]) if (near.has(w.a) && near.has(w.b)) (near.get(w.a).add(w.b), near.get(w.b).add(w.a));
  const order = sorted([...nodes.keys()], ways, made, near), rank = new Map(order.map((id, k) => [id, k]));
  // Which end should stand over: the depended on, a headed link's tail, what holds what a headless link ties to it.
  const upper = (w) => (w.type && headless.includes(w.type) ? w.b : w.a);
  const against = (w) => rank.get(upper(w)) > rank.get(upper(w) === w.a ? w.b : w.a);
  return { nodes, chains, ties, potential, order, rank, against };
}
