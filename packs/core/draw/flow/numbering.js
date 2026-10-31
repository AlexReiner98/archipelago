// Which way every wire of a planar graph runs, the order's way where it can. A numbering gives each item but its top and
// foot a wire in and a wire out, and the order has many starts and ends, so it gets a top and a foot of its own, on the
// outer face, and each start or end is lent its missing side: by a tie that has no way of its own, or by an invisible
// edge across one of its faces. What is left to do is walk the items, order first, keeping every step a true numbering:
// what is done so far stays joined, and so does what is left. Pure: a graph in, its numbering out.

import { pair } from './polyline.js';


const TOP = 'ghost top', FOOT = 'ghost foot';
/** How much an order wire outweighs a wish of the numbering's own, when one of them has to go. */
const ORDER_WEIGHT = 4;
/** The strength of a wire of the order itself, which nothing passes under; what a weak link running up counts for, against a headed one. */
const STRONG = 3, WEAK = 0.02;
/** How many wires times items may be spent on trying tops and feet. */
const WORK = 3e6;
/** Past this many items and points in a part, only what the order holds passes under a tie: on a big map of ties it brings crossings and takes long. */
const UNDER_MOST = 120;
/** An order wire running up counts for more than any wire's length. */
const OVER = 1e6;

/** Marks in `parting` the items of what is `left` that would part it if taken, walked from `root` (Tarjan). Items are numbers here. */
function cuts(near, left, root, parting, at, low) {
  at.fill(-1);
  parting.fill(0);
  let clock = 0;
  const walk = (v, from) => {
    at[v] = low[v] = clock++;
    let kids = 0;
    for (const w of near[v]) {
      if (w === from || !left[w]) continue;
      if (at[w] >= 0) { if (at[w] < low[v]) low[v] = at[w]; continue; }
      kids++;
      walk(w, v);
      if (low[w] < low[v]) low[v] = low[w];
      if (v !== root && low[w] >= at[v]) parting[v] = 1;
    }
    if (v === root && kids > 1) parting[v] = 1;
  };
  walk(root, -1);
}

/**
 * Number the items from `s` to `t`, each joined to one before it and one after. Of the items that may come next, the one
 * that leaves least of what it wants before it undone (`wants`, [a, b, weight]), then the highest by `level`.
 */
function walkDown(near, s, t, wants, deep) {
  const names = [...near.keys()], n = names.length, index = new Map(names.map((v, k) => [v, k])), around = names.map((v) => [...near.get(v)].map((w) => index.get(w)));
  const before = names.map(() => []), left = new Uint8Array(n).fill(1), touched = new Uint8Array(n), parting = new Uint8Array(n), at = new Int32Array(n), low = new Int32Array(n);
  const level = new Array(n).fill(-Infinity), rank = names.map((v) => deep.get(v)), number = new Map([[s, 0]]), [start, foot] = [index.get(s), index.get(t)];
  for (const [a, b, weight] of wants) before[index.get(b)].push([index.get(a), weight]);
  const take = (v) => { left[v] = 0; for (const w of around[v]) touched[w] = 1; };
  take(start);
  level[start] = -1;
  const rise = (v) => rank[v] ?? 1 + around[v].reduce((m, w) => (left[w] ? m : Math.max(m, level[w])), -Infinity);
  for (let more = n - 2; more > 0; more--) {
    cuts(around, left, foot, parting, at, low);
    let best = -1, least = Infinity, high = Infinity;
    for (let v = 0; v < n; v++) {
      if (!left[v] || !touched[v] || v === foot || parting[v]) continue;
      let cost = 0;
      for (const [a, weight] of before[v]) if (left[a]) cost += weight;
      const l = rise(v);
      if (cost < least || (cost === least && l < high)) ((best = v), (least = cost), (high = l));
    }
    if (best < 0) throw new Error('No item can come next');
    level[best] = high;
    number.set(names[best], number.size);
    take(best);
  }
  number.set(t, number.size);
  return number;
}

/** How far the wires run down, in rows: of numberings as true to the order, the shortest is kept. */
function reach(g, number, near) {
  const level = new Map();
  for (const v of [...number.keys()].sort((p, q) => number.get(p) - number.get(q))) level.set(v, 1 + Math.max(-1, ...[...near.get(v)].filter((w) => level.has(w)).map((w) => level.get(w))));
  let sum = 0;
  for (const w of g.wires) if (w.visible) sum += Math.abs(level.get(w.path[0]) - level.get(w.path.at(-1)));
  return sum;
}

/** The graph with a top and foot beside the wire x to y of the outer face, its ways chosen as far as they can be. */
function ways(g, outerAt, x, y) {
  const faces = g.faces.map((f) => [...f]), outer = faces[outerAt], n = outer.length, at = outer.indexOf(x);
  const step = outer[(at + 1) % n] === y ? n - 1 : 1, ring = outer.map((_, k) => outer[(at + step * k) % n]);
  faces[outerAt] = [TOP, ...ring, FOOT];
  faces.push([TOP, x, y, FOOT]);
  const near = new Map(), after = new Map(), before = new Map(), hidden = [TOP + '|' + x, y + '|' + FOOT].map((k) => k.split('|')), wants = [], splits = [];
  const tie = (a, b) => {
    (near.get(a) ?? near.set(a, new Set()).get(a)).add(b);
    (near.get(b) ?? near.set(b, new Set()).get(b)).add(a);
  };
  for (const k of g.owner.keys()) tie(...k.split('|'));
  tie(TOP, x), tie(y, FOOT), tie(TOP, FOOT);
  hidden.push([TOP, FOOT]);
  const reaches = (a, b) => {
    const seen = new Set([a]), todo = [a];
    while (todo.length) for (const w of after.get(todo.pop()) ?? []) {
      if (w === b) return true;
      if (!seen.has(w)) (seen.add(w), todo.push(w));
    }
    return false;
  };
  let deep = null;
  /** The longest way down to each item the ways so far hold. */
  const depths = () => {
    if (deep) return deep;
    deep = new Map();
    const open = new Map([...after.keys(), ...before.keys()].map((v) => [v, before.get(v)?.size ?? 0])), queue = [...open.keys()].filter((v) => !open.get(v));
    for (const v of queue) deep.set(v, 0);
    for (let k = 0; k < queue.length; k++) for (const w of after.get(queue[k]) ?? []) {
      deep.set(w, Math.max(deep.get(w) ?? 0, deep.get(queue[k]) + 1));
      open.set(w, open.get(w) - 1);
      if (!open.get(w)) queue.push(w);
    }
    return deep;
  };
  const depth = (v) => depths().get(v) ?? 0;
  /** Say that `a` comes before `b`, unless the ways so far say otherwise. */
  const lead = (a, b) => {
    if (after.get(a)?.has(b)) return true;
    if (a === b || reaches(b, a)) return false;
    (after.get(a) ?? after.set(a, new Set()).get(a)).add(b);
    (before.get(b) ?? before.set(b, new Set()).get(b)).add(a);
    deep = null;
    return true;
  };
  /** An invisible edge across a face, from `a` to `b`. */
  const chord = (a, b) => {
    const hold = faces.findIndex((f) => f.includes(a) && f.includes(b));
    if (hold < 0 || near.get(a).has(b)) return false;
    const f = faces[hold], [m, k] = [f.indexOf(a), f.indexOf(b)].sort((p, q) => p - q);
    faces.splice(hold, 1, f.slice(m, k + 1), [...f.slice(k), ...f.slice(0, m + 1)]);
    tie(a, b);
    hidden.push([a, b]);
    return lead(a, b);
  };
  const stretches = (path) => path.slice(1).map((v, i) => [path[i], v]);
  const orderWires = g.wires.filter((w) => w.link?.[2]).sort((p, q) => q.link[2] - p.link[2] || p.path.length - q.path.length);
  for (const w of orderWires) for (const [a, b] of stretches(w.path)) (wants.push([a, b, ORDER_WEIGHT * w.link[2]]), lead(a, b));
  const inOrder = [...new Set([...after.keys(), ...before.keys()])].filter((v) => !v.startsWith('ghost'));
  lead(TOP, x), lead(y, FOOT), lead(TOP, FOOT);
  for (const w of g.wires) if (w.leads) stretches(w.path).forEach(([a, b]) => lead(a, b));
  // A wire that crosses another runs one way through it, so that it does not double back at the crossing.
  for (const w of g.wires) {
    if (w.path.length < 3 || w.link?.[2] || !w.visible) continue;
    const [u, v] = [w.path[0], w.path.at(-1)];
    for (const [a, b] of stretches(depth(u) <= depth(v) && !reaches(v, u) ? w.path : [...w.path].reverse())) lead(a, b);
  }
  const lacksIn = (v) => !before.get(v)?.size, lacksOut = (v) => !after.get(v)?.size;
  // The outer face: starts along one stretch of it can reach the top, and ends along the other the foot.
  const kept = ring.map((v) => inOrder.includes(v));
  let cut = 0, most = -1;
  for (let k = 0; k <= ring.length; k++) {
    const gain = ring.reduce((sum, v, i) => sum + (kept[i] && (i < k ? lacksIn(v) : lacksOut(v)) ? 1 : 0), 0);
    if (gain > most) ((most = gain), (cut = k));
  }
  ring.forEach((v, i) => { if (kept[i] && i < cut && lacksIn(v)) chord(TOP, v); });
  [...ring].reverse().forEach((v, k) => { const i = ring.length - 1 - k; if (kept[i] && i >= cut && lacksOut(v)) chord(v, FOOT); });
  // A tie has no way of its own, so it lends one to what lacks it.
  const free = (v) => [...near.get(v)].filter((w) => !after.get(v)?.has(w) && !after.get(w)?.has(v));
  const ordered = new Set(inOrder), everyone = [...inOrder.sort((p, q) => depth(p) - depth(q)), ...(inOrder.length ? [...near.keys()].filter((v) => !ordered.has(v) && v !== TOP && v !== FOOT).sort((p, q) => depth(p) - depth(q)) : [])];
  const lend = () => {
    for (const v of everyone) {
      if (lacksIn(v)) {
        const from = free(v).filter((w) => w !== FOOT && !reaches(v, w)).sort((p, q) => depth(p) - depth(q))[0];
        if (from !== undefined) lead(from, v);
      }
      if (lacksOut(v)) {
        const to = free(v).filter((w) => w !== TOP && !reaches(w, v)).sort((p, q) => depth(q) - depth(p))[0];
        if (to !== undefined) lead(v, to);
      }
    }
  };
  // What no tie could lend, an invisible edge across a face does, from as high as that face goes, or to as low.
  const mates = (v, skip) => [...new Set(faces.filter((f) => f.includes(v)).flat())].filter((u) => u !== v && u !== skip && !near.get(v).has(u));
  const span = () => {
    for (const v of everyone) {
      if (lacksIn(v)) {
        const from = mates(v, FOOT).filter((u) => !reaches(v, u)).sort((p, q) => depth(p) - depth(q))[0];
        if (from !== undefined) chord(from, v);
      }
      if (lacksOut(v)) {
        const to = mates(v, TOP).filter((u) => !reaches(u, v)).sort((p, q) => depth(q) - depth(p))[0];
        if (to !== undefined) chord(v, to);
      }
    }
  };
  // An item shut in by what comes after it (or before it) has no such edge. An invisible edge may still pass under a tie,
  // or under another invisible edge: nothing is drawn there, and the tie bends round the item. An order wire it may not.
  const fixed = new Set(orderWires.filter((w) => w.link[2] >= STRONG).flatMap((w) => stretches(w.path).map(([a, b]) => pair(a, b))));
  const edgesOf = (f) => f.map((a, k) => [a, f[(k + 1) % f.length]]);
  /** The nearest face that holds an item `fits`, and the ties passed under on the way there. */
  const route = (v, fits) => {
    const seen = new Set(), queue = [], beside = new Map();
    faces.forEach((f, i) => {
      for (const [a, b] of edgesOf(f)) (beside.get(pair(a, b)) ?? beside.set(pair(a, b), []).get(pair(a, b))).push(i);
      if (f.includes(v)) (seen.add(i), queue.push({ i, under: [] }));
    });
    for (let k = 0; k < queue.length; k++) {
      const { i, under } = queue[k], f = faces[i], found = under.length ? f.filter((u) => u !== v && fits(u) && !under.some(([a, b]) => a === u || b === u)) : [];
      if (found.length) return { under, found };
      for (const [a, b] of edgesOf(f)) {
        if (a === v || b === v || fixed.has(pair(a, b)) || !g.owner.has(pair(a, b))) continue;
        const o = beside.get(pair(a, b)).find((n) => n !== i);
        if (o !== undefined && !seen.has(o)) (seen.add(o), queue.push({ i: o, under: [...under, [a, b]] }));
      }
    }
    return null;
  };
  /** A point on the stretch a to b, which lets go of any way it was lent. */
  const split = (a, b) => {
    const d = `ghost under ${splits.length}`;
    splits.push([a, b, d]);
    for (const f of faces) for (let k = 0; k < f.length; k++) {
      const [p, q] = [f[k], f[(k + 1) % f.length]];
      if (pair(p, q) === pair(a, b)) { f.splice(k + 1, 0, d); break; }
    }
    near.get(a).delete(b), near.get(b).delete(a);
    tie(a, d), tie(d, b);
    for (const [p, q] of [[a, b], [b, a]]) if (after.get(p)?.delete(q)) (before.get(q).delete(p), (deep = null));
    return d;
  };
  const under = () => {
    let moved = false;
    for (const v of near.size > UNDER_MOST ? everyone.filter((u) => ordered.has(u) || u.startsWith('ghost')) : everyone) for (const [lacks, skip, sooner] of [[lacksIn, FOOT, true], [lacksOut, TOP, false]]) {
      if (!lacks(v)) continue;
      const way = route(v, (u) => u !== skip && !near.get(v).has(u) && !(sooner ? reaches(v, u) : reaches(u, v)));
      if (!way) continue;
      const end = way.found.sort((p, q) => (sooner ? depth(p) - depth(q) : depth(q) - depth(p)))[0];
      let at = v;
      for (const step of [...way.under, null]) {
        const next = step ? split(...step) : end;
        if (sooner) chord(next, at); else chord(at, next);
        at = next;
      }
      moved = true;
    }
    return moved;
  };
  lend(), span();
  for (let round = 0; round < 4 && under(); round++) (lend(), span());
  for (const [a, set] of after) if (a !== TOP) for (const b of set) if (b !== FOOT && !wants.some((w) => w[0] === a && w[1] === b)) wants.push([a, b, 1]);
  return { faces, near, hidden, splits, wants, deep: new Map([...depths()].filter(([v]) => before.has(v) || after.has(v))) };
}

/**
 * Give `g` of planarize a numbering: the top and foot to it, and the invisible edges it took. Answers with them, and which
 * face is the outer one. Each wire of the outer face is tried as the place for them, as many as there is time for, and
 * the one that leaves the fewest order wires running up is kept. `nth` says which face is outer, the longest first, and
 * `most` caps the places tried.
 */
export function numbered(g, nth = 0, most = Infinity) {
  const longest = g.faces.map((_, i) => i).sort((p, q) => g.faces[q].length - g.faces[p].length || p - q), outerAt = longest[Math.min(nth, longest.length - 1)], outer = g.faces[outerAt];
  const orders = g.wires.filter((w) => w.link?.[2]), size = g.owner.size * new Set([...g.owner.keys()].flatMap((k) => k.split('|'))).size;
  const places = outer.flatMap((v, i) => [[v, outer[(i + 1) % outer.length]], [outer[(i + 1) % outer.length], v]]);
  const tries = orders.length ? Math.max(1, Math.min(places.length, most, Math.ceil(WORK / size))) : 1;
  let best = null, least = Infinity;
  for (let k = 0; k < tries; k++) {
    const [x, y] = places[Math.floor((k * places.length) / tries)], laid = ways(g, outerAt, x, y);
    const number = walkDown(laid.near, TOP, FOOT, laid.wants, laid.deep);
    const up = orders.filter((w) => w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v))).reduce((sum, w) => sum + (w.link[2] > 1 ? 1 : WEAK), 0);
    const score = up * OVER + reach(g, number, laid.near);
    if (score < least) ((least = score), (best = { ...laid, number }));
  }
  g.faces = best.faces;
  for (const [a, b, d] of best.splits) {
    const w = g.owner.get(pair(a, b));
    w.path.splice(w.path.findIndex((v, i) => i && pair(w.path[i - 1], v) === pair(a, b)), 0, d);
    g.owner.delete(pair(a, b));
    g.owner.set(pair(a, d), w);
    g.owner.set(pair(d, b), w);
  }
  for (const [a, b] of best.hidden) {
    const w = { path: [a, b], visible: false, link: null };
    g.wires.push(w);
    g.owner.set(pair(a, b), w);
  }
  const top = (f) => f.some((v, i) => (v === TOP && f[(i + 1) % f.length] === FOOT) || (v === FOOT && f[(i + 1) % f.length] === TOP));
  return { s: TOP, t: FOOT, number: best.number, outerAt: g.faces.findIndex(top) };
}
