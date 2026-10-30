// Which way every wire of a planar graph runs, the order's way where it can. A numbering gives each item but its top and
// foot a wire in and a wire out, and the order has many starts and ends, so it gets a top and a foot of its own, on the
// outer face, and each start or end is lent its missing side: by a tie that has no way of its own, or by an invisible
// edge across one of its faces. What is left to do is walk the items, order first, keeping every step a true numbering:
// what is done so far stays joined, and so does what is left. Pure: a graph in, its numbering out.

const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const TOP = 'ghost top', FOOT = 'ghost foot';
/** How much an order wire outweighs a wish of the numbering's own, when one of them has to go. */
const ORDER_WEIGHT = 4;
/** How many wires times items may be spent on trying tops and feet. */
const WORK = 3e6;

/** The items of what is `left` that would part it if taken, walked from `root` (Tarjan). */
function cuts(near, left, root) {
  const at = new Map(), low = new Map(), out = new Set();
  let clock = 0;
  const walk = (v, from) => {
    at.set(v, clock);
    low.set(v, clock++);
    let kids = 0;
    for (const w of near.get(v)) {
      if (w === from || !left.has(w)) continue;
      if (at.has(w)) { low.set(v, Math.min(low.get(v), at.get(w))); continue; }
      kids++;
      walk(w, v);
      low.set(v, Math.min(low.get(v), low.get(w)));
      if (v !== root && low.get(w) >= at.get(v)) out.add(v);
    }
    if (v === root && kids > 1) out.add(v);
  };
  walk(root, null);
  return out;
}

/**
 * Number the items from `s` to `t`, each joined to one before it and one after. Of the items that may come next, the one
 * that leaves least of what it wants before it undone (`wants`, [a, b, weight]), then the highest by `level`.
 */
function walkDown(near, s, t, wants, deep) {
  const before = new Map(), done = new Set([s]), left = new Set([...near.keys()].filter((v) => v !== s)), number = new Map([[s, 0]]), level = new Map([[s, -1]]);
  for (const [a, b, weight] of wants) (before.get(b) ?? before.set(b, []).get(b)).push([a, weight]);
  const rise = (v) => deep.get(v) ?? 1 + Math.max(...[...near.get(v)].filter((w) => done.has(w)).map((w) => level.get(w)));
  while (left.size > 1) {
    const parting = cuts(near, left, t);
    let best = null, least = Infinity, high = Infinity;
    for (const v of left) {
      if (v === t || parting.has(v) || ![...near.get(v)].some((w) => done.has(w))) continue;
      const cost = (before.get(v) ?? []).reduce((sum, [a, weight]) => sum + (done.has(a) ? 0 : weight), 0), l = rise(v);
      if (cost < least || (cost === least && l < high)) ((best = v), (least = cost), (high = l));
    }
    if (best === null) throw new Error('No item can come next');
    level.set(best, high);
    number.set(best, number.size);
    done.add(best);
    left.delete(best);
  }
  number.set(t, number.size);
  return number;
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
  const orderWires = g.wires.filter((w) => w.link?.[2]).sort((p, q) => p.path.length - q.path.length);
  for (const w of orderWires) for (const [a, b] of stretches(w.path)) (wants.push([a, b, ORDER_WEIGHT]), lead(a, b));
  const inOrder = [...new Set([...after.keys(), ...before.keys()])].filter((v) => !v.startsWith('ghost'));
  lead(TOP, x), lead(y, FOOT), lead(TOP, FOOT);
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
  const fixed = new Set(orderWires.flatMap((w) => stretches(w.path).map(([a, b]) => pair(a, b))));
  const edgesOf = (f) => f.map((a, k) => [a, f[(k + 1) % f.length]]);
  /** The nearest face that holds an item `fits`, and the ties passed under on the way there. */
  const route = (v, fits) => {
    const seen = new Set(), queue = [];
    faces.forEach((f, i) => { if (f.includes(v)) (seen.add(i), queue.push({ i, under: [] })); });
    for (let k = 0; k < queue.length; k++) {
      const { i, under } = queue[k], f = faces[i], found = under.length ? f.filter((u) => u !== v && fits(u) && !under.some(([a, b]) => a === u || b === u)) : [];
      if (found.length) return { under, found };
      for (const [a, b] of edgesOf(f)) {
        if (a === v || b === v || fixed.has(pair(a, b)) || !g.owner.has(pair(a, b))) continue;
        const o = faces.findIndex((h, n) => n !== i && edgesOf(h).some(([p, q]) => pair(p, q) === pair(a, b)));
        if (o >= 0 && !seen.has(o)) (seen.add(o), queue.push({ i: o, under: [...under, [a, b]] }));
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
    for (const v of everyone) for (const [lacks, skip, sooner] of [[lacksIn, FOOT, true], [lacksOut, TOP, false]]) {
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
 * the one that leaves the fewest order wires running up is kept.
 */
export function numbered(g) {
  const outerAt = g.faces.reduce((m, f, i) => (f.length > g.faces[m].length ? i : m), 0), outer = g.faces[outerAt];
  const orders = g.wires.filter((w) => w.link?.[2]), size = g.owner.size * new Set([...g.owner.keys()].flatMap((k) => k.split('|'))).size;
  const places = outer.flatMap((v, i) => [[v, outer[(i + 1) % outer.length]], [outer[(i + 1) % outer.length], v]]);
  const tries = orders.length ? Math.max(1, Math.min(places.length, Math.ceil(WORK / size))) : 1;
  let best = null, least = Infinity;
  for (let k = 0; k < tries && least > 0; k++) {
    const [x, y] = places[Math.floor((k * places.length) / tries)], laid = ways(g, outerAt, x, y);
    const number = walkDown(laid.near, TOP, FOOT, laid.wants, laid.deep);
    const up = orders.filter((w) => w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v))).length;
    if (up < least) ((least = up), (best = { ...laid, number }));
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
