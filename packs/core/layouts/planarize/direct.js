// Every link of a picture as one wire between two steps, and which way each runs (task e_snvzsxj4). Links between one
// pair go as one wire: all the same way, one wire that way; opposed (A about B and B about A, or part of one way and
// about back), one tie with no head and no way. Then the order the wires ask for: down from the upper end, with each
// ring broken by turning the fewest wires (Eades, Lin and Smyth's greedy rule), ties by when each step was made, so the
// answer never changes between runs. A turned wire runs up. Layer: graph. Pure: the kit's graph in, wires out.

import { ORDER } from './graph.js';

/**
 * The kit's graph `m` (./model.js) as wires: { id, u, v, types, order, directed }, u the upper end of a wire with a
 * way (what is depended on, a headed link's tail, what holds what a headless link ties to it), or the end made first of
 * a tie with none. `links` lists the links each wire stands for, as { a, b, type }.
 */
export function joined(m, headless) {
  const all = [
    ...m.chains.map((c) => ({ a: c.a, b: c.b, type: ORDER })),
    ...m.ties.map((t) => (headless.includes(t.type) ? { a: t.b, b: t.a, type: t.type } : { a: t.a, b: t.b, type: t.type })),
  ].filter((l) => l.a !== l.b && m.nodes.has(l.a) && m.nodes.has(l.b));
  const made = (id) => m.nodes.get(id).made, byPair = new Map();
  for (const l of all) {
    const key = made(l.a) < made(l.b) ? `${l.a} ${l.b}` : `${l.b} ${l.a}`;
    (byPair.get(key) ?? byPair.set(key, []).get(key)).push(l);
  }
  const wires = [];
  for (const [key, links] of byPair) {
    const [first, second] = key.split(' '), directed = links.every((l) => l.a === links[0].a);
    const [u, v] = directed ? [links[0].a, links[0].b] : [first, second];
    const types = [...new Set(links.map((l) => l.type))];
    wires.push({ id: `w${wires.length}`, u, v, types, order: types.includes(ORDER), directed, links });
  }
  return wires;
}

/**
 * The steps in an order that turns the fewest of `wires` (Eades, Lin and Smyth): what nothing leaves goes last, what
 * nothing enters goes first, and else the one that most leaves more than it enters, the one made first of equals.
 * Answers the order and the set of wires that run against it, each to be turned.
 */
export function feedback(ids, wires, made) {
  const out = new Map(ids.map((v) => [v, []])), into = new Map(ids.map((v) => [v, []]));
  for (const w of wires) if (w.directed && w.u !== w.v) (out.get(w.u).push(w), into.get(w.v).push(w));
  const left = new Set(ids), head = [], tail = [];
  const degree = (v, list, end) => list.get(v).filter((w) => left.has(w[end])).length;
  const byMade = (p, q) => made(p) - made(q);
  while (left.size) {
    let moved = true;
    while (moved) {
      moved = false;
      const sinks = [...left].filter((v) => !degree(v, out, 'v')).sort(byMade);
      for (const v of sinks) (left.delete(v), tail.unshift(v), (moved = true));
      const sources = [...left].filter((v) => !degree(v, into, 'u')).sort(byMade);
      for (const v of sources) (left.delete(v), head.push(v), (moved = true));
    }
    if (!left.size) break;
    const pick = [...left].sort((p, q) => degree(q, out, 'v') - degree(q, into, 'u') - (degree(p, out, 'v') - degree(p, into, 'u')) || byMade(p, q))[0];
    left.delete(pick);
    head.push(pick);
  }
  const order = [...head, ...tail], at = new Map(order.map((v, k) => [v, k]));
  return { order, turned: new Set(wires.filter((w) => w.directed && at.get(w.u) > at.get(w.v))) };
}

/** `wires` with their way set: `top` and `foot` (u and v, swapped where it is turned), and `turned` where it runs up. */
export function directed(wires, ids, made) {
  const { order, turned } = feedback(ids, wires, made);
  const out = wires.map((w) => ({ ...w, turned: turned.has(w), top: turned.has(w) ? w.v : w.u, foot: turned.has(w) ? w.u : w.v }));
  return { wires: out, order };
}
