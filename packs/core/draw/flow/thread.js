// A graph made planar, ready to draw: links threaded through the faces, each crossing a point of the graph, so what is left
// has no crossing in it but those points. Each point is numbered between the ends of the stretch it splits, where the graph
// has numbers. Pure: a graph in, changed in place, or edges in and a graph of wires and faces out.

import { blocks, faces, isPlanar, keptPlanar } from './planar.js';
import { pair } from './polyline.js';


/** What it costs to cross a hidden link: nothing to see, but it is a turn. */
const HIDDEN = 0.1;
/** Spreads the points' numbers, so no two are ever alike. */
const GOLD = 0.618034;
/** Past this many biconnected pieces, they are joined many at a time. */
const MANY_PIECES = 64;

/** Take the nearest off `open`, then the least far on. */
const nextOf = (open, dist, reach) => {
  let k = 0;
  for (let n = 1; n < open.length; n++) if (dist.get(open[n]) < dist.get(open[k]) || (reach && dist.get(open[n]) === dist.get(open[k]) && reach.get(open[n]) < reach.get(open[k]))) k = n;
  return open.splice(k, 1)[0];
};

/** The faces of `list` by stretch, kept true as they change. `name` is `pair`, remembered: it is asked for very often. */
function seating(list) {
  const names = new Map(), seat = new Map();
  const name = (a, b) => {
    const of = names.get(a) ?? names.set(a, new Map()).get(a);
    return of.get(b) ?? of.set(b, pair(a, b)).get(b);
  };
  const sit = (f) => f.forEach((a, k) => { const e = name(a, f[(k + 1) % f.length]); (seat.get(e) ?? seat.set(e, []).get(e)).push(f); });
  const leave = (f) => f.forEach((a, k) => { const s = seat.get(name(a, f[(k + 1) % f.length])); s.splice(s.indexOf(f), 1); });
  list.forEach(sit);
  return {
    name,
    of: (e) => seat.get(e) ?? [],
    /** `f` in `list` given way to `pieces`. */
    swap(f, ...pieces) { leave(f); list.splice(list.indexOf(f), 1, ...pieces); pieces.forEach(sit); },
    /** The point `d` on the stretch `a` to `b`, in each face it runs along. */
    within(a, b, d) { for (const f of [...seat.get(name(a, b))]) { const k = f.findIndex((p, n) => name(p, f[(n + 1) % f.length]) === name(a, b)); leave(f); f.splice(k + 1, 0, d); sit(f); } },
    /** The point `d` out of its faces, the stretch through it one again. */
    without(d) { for (const f of list.filter((p) => p.includes(d))) { leave(f); f.splice(f.indexOf(d), 1); sit(f); } },
  };
}

/** The way round `f` from `a` to `b`, away from the stretch that joins them. */
const roundFace = (f, a, b) => {
  const n = f.length, at = f.indexOf(a), step = f[(at + 1) % n] === b ? n - 1 : 1, out = [];
  for (let k = at; f[k] !== b; k = (k + step) % n) out.push(f[k]);
  return [...out, b];
};

/**
 * A threader over `list`, the faces: `through` threads each of `links`, a list of [u, v], through them; `nearest` finds the
 * face for a new item and `put` places it; `again` shortens what is threaded. `owner` says which wire holds each stretch and
 * `add(path, visible, link)` makes a wire. With `onward(link)`, that link only ever goes on through `number`, so it runs
 * from u to v the way the numbers do; with `oneWay`, every other link does too, from whichever end comes first, so no
 * wire turns back and any can be taken out again. The stretch `keep` is never crossed. It keeps count in `tally`: { ghosts, crossings,
 * unthreaded }.
 */
export function threader(list, owner, add, { number, keep, onward = () => false, oneWay = false }) {
  const tally = { ghosts: [], crossings: 0, unthreaded: 0 }, at = (v) => number.get(v), around = new Map(), seats = seating(list), { name } = seats;
  let made = 0;
  const tie = (a, b) => {
    (around.get(a) ?? around.set(a, new Set()).get(a)).add(b);
    (around.get(b) ?? around.set(b, new Set()).get(b)).add(a);
  };
  const untie = (a, b) => (around.get(a).delete(b), around.get(b).delete(a));
  const lay = (path, visible, link) => {
    add(path, visible, link);
    path.slice(1).forEach((v, i) => tie(path[i], v));
  };
  for (const k of owner.keys()) tie(...k.split('|'));

  /** The face nearest all of `near`, by what it costs to reach each from it, leaving out those `barred` says. */
  const nearest = (near, barred) => {
    const total = new Map(list.map((f) => [f, 0]));
    for (const v of near) {
      const dist = new Map(), open = [];
      for (const f of list) if (f.includes(v)) (dist.set(f, 0), open.push(f));
      while (open.length) {
        const f = nextOf(open, dist);
        f.forEach((a, k) => {
          const e = name(a, f[(k + 1) % f.length]), cost = dist.get(f) + (owner.get(e)?.visible ? 1 : HIDDEN);
          if (e === keep) return;
          for (const n of seats.of(e)) if (n !== f && (!dist.has(n) || cost < dist.get(n))) (dist.set(n, cost), open.push(n));
        });
      }
      for (const f of list) total.set(f, total.get(f) + (dist.get(f) ?? list.length));
    }
    let best = null;
    for (const f of list) if (!barred(f) && (!best || total.get(f) < total.get(best))) best = f;
    return best;
  };

  /** Item `v` into face `f`, numbered as near `want` as it can be, on hidden wires from the face's top to its foot. */
  const put = (v, f, want) => {
    const low = f.reduce((m, a, k) => (number.get(a) < number.get(f[m]) ? k : m), 0), high = f.reduce((m, a, k) => (number.get(a) > number.get(f[m]) ? k : m), 0);
    const [lo, hi] = [number.get(f[low]), number.get(f[high])], [m, n] = [low, high].sort((p, q) => p - q);
    number.set(v, Math.min(lo + (hi - lo) * 0.9, Math.max(lo + (hi - lo) * 0.1, want)) + (hi - lo) * 1e-3 * ((number.size * GOLD) % 1));
    lay([f[low], v], false, null);
    lay([v, f[high]], false, null);
    seats.swap(f, [...f.slice(m, n + 1), v], [...f.slice(n), ...f.slice(0, m + 1), v]);
  };

  /** How far on through the numbers a wire from `u` to `v` must already be to cross stretch `e`, or null when it cannot. */
  const past = (e, h, u, v) => {
    const [a, b] = e.split('|'), hi = Math.max(at(a), at(b)), lo = Math.max(h, Math.min(at(a), at(b)));
    return a !== u && b !== u && a !== v && b !== v && lo < hi && lo < at(v) ? lo : null;
  };

  /** The faces from one holding `u` to one holding `v` and the stretches passed on the way, the fewest crossed, or null. */
  const wayOf = (u, v, strict) => {
    const dist = new Map(), reach = new Map(), prev = new Map(), open = [];
    for (const f of list) if (f.includes(u)) (dist.set(f, 0), reach.set(f, strict ? at(u) : 0), open.push(f));
    const nearer = (f, d, h) => !dist.has(f) || d < dist.get(f) || (d === dist.get(f) && h < reach.get(f));
    while (open.length) {
      const f = nextOf(open, dist, reach);
      if (f.includes(v)) {
        const steps = [], rooms = [f];
        for (let i = f; prev.has(i); i = prev.get(i)[0]) (steps.unshift(prev.get(i)[1]), rooms.unshift(prev.get(i)[0]));
        return { steps, rooms };
      }
      f.forEach((a, k) => {
        const e = name(a, f[(k + 1) % f.length]), cost = dist.get(f) + (owner.get(e)?.visible ? 1 : HIDDEN);
        if (e === keep) return;
        const h = strict ? past(e, reach.get(f), u, v) : reach.get(f);
        if (h === null) return;
        for (const n of seats.of(e)) if (n !== f && nearer(n, cost, h)) (dist.set(n, cost), reach.set(n, h), prev.set(n, [f, e]), open.push(n));
      });
    }
    return null;
  };

  const through = (links) => { for (const l of links) {
    const told = onward(l), turned = oneWay && !told && at(l[0]) > at(l[1]), [u, v] = turned ? [l[1], l[0]] : l, hidden = owner.get(name(u, v));
    // A hidden wire between the two already: it just shows.
    if (hidden) { Object.assign(hidden, { visible: true, link: l, path: [l[0], l[1]] }); continue; }
    const strict = told || oneWay, way = wayOf(u, v, strict);
    if (!way) { tally.unthreaded++; continue; }
    const { steps, rooms } = way;
    // Each point between what is before it and what it must leave room for.
    const under = steps.map(() => Infinity), points = [];
    if (strict) for (let k = steps.length - 1, top = at(v); k >= 0; k--) {
      const [a, b] = steps[k].split('|');
      top = under[k] = Math.min(top, Math.max(at(a), at(b)));
    }
    let run = strict ? at(u) : -Infinity;
    for (let k = 0; k < steps.length; k++) {
      const e = steps[k], [a, b] = e.split('|'), d = `ghost${made++}`, w = owner.get(e), lo = Math.max(run, Math.min(at(a), at(b)));
      // Never on a number something already has: a face tells its top from its foot by them.
      number.set(d, lo + (Math.min(under[k], Math.max(at(a), at(b))) - lo) * (0.4 + 0.2 * ((made * GOLD) % 1)));
      run = strict ? at(d) : run;
      tally.ghosts.push(d);
      if (w.visible) tally.crossings++;
      seats.within(a, b, d);
      untie(a, b), tie(a, d), tie(d, b);
      const pos = w.path.findIndex((x, i) => i && name(w.path[i - 1], x) === e);
      w.path.splice(pos, 0, d);
      owner.delete(e);
      owner.set(name(a, d), w);
      owner.set(name(d, b), w);
      points.push(d);
    }
    const path = [u, ...points, v];
    lay(turned ? [...path].reverse() : path, true, l);
    path.slice(1).forEach((q, i) => {
      const p = path[i], f = rooms[i], [m, n] = [f.indexOf(p), f.indexOf(q)].sort((x, y) => x - y);
      seats.swap(f, f.slice(m, n + 1), [...f.slice(n), ...f.slice(0, m + 1)]);
    });
  } };

  const others = (p, w) => [...around.get(p)].filter((o) => owner.get(name(p, o)) !== w);
  /** Whether `p` has a wire on the way `later` says, other than `w`. */
  const hasWay = (p, later, w) => others(p, w).some((o) => at(o) > at(p) === later);
  /** Whether each end of `w` has, by another wire, what it would lose. */
  const spare = ({ path }, w) => hasWay(path[0], at(path[1]) > at(path[0]), w) && hasWay(path.at(-1), at(path.at(-2)) > at(path.at(-1)), w);
  /** Whether each wire `w` crosses can go back as it was. */
  const free = (w) => {
    const { path } = w, inner = new Set(path.slice(1, -1));
    for (const d of inner) {
      if (around.get(d).size !== 4) return false;
      const x = owner.get(name(d, others(d, w)[0])), kept = x.path.filter((p) => !inner.has(p));
      for (let i = 1; i < kept.length; i++) {
        const holds = owner.get(name(kept[i - 1], kept[i]));
        if (holds && holds !== x) return false;
      }
    }
    return true;
  };

  /** Wire `w` out, and the points it crosses at with it. */
  const take = (w) => {
    const { path } = w;
    path.slice(1).forEach((q, i) => {
      const p = path[i], e = name(p, q), [f, g] = seats.of(e), joined = [...roundFace(f, q, p), ...roundFace(g, p, q).slice(1, -1)];
      seats.swap(g);
      seats.swap(f, joined);
      owner.delete(e);
      untie(p, q);
    });
    for (const d of path.slice(1, -1)) {
      const [a, b] = around.get(d), x = owner.get(name(a, d));
      seats.without(d);
      owner.delete(name(a, d));
      owner.delete(name(d, b));
      untie(a, d), untie(d, b), tie(a, b);
      owner.set(name(a, b), x);
      x.path.splice(x.path.indexOf(d), 1);
      if (x.visible && w.visible) tally.crossings--;
      tally.ghosts.splice(tally.ghosts.indexOf(d), 1);
      number.delete(d);
      around.delete(d);
    }
  };

  /** Every hidden one of `wires` that nothing needs taken out: each holds rows apart and makes room for nothing. */
  const prune = (wires) => {
    for (const w of wires.filter((x) => !x.visible && name(x.path[0], x.path.at(-1)) !== keep)) {
      if (!spare(w, w) || !free(w)) continue;
      take(w);
      wires.splice(wires.indexOf(w), 1);
    }
  };

  /** Each of `wires` that crosses something taken out and threaded again the shortest way the numbers leave, for `rounds` or until it gains nothing. */
  const again = (wires, rounds) => {
    for (let round = 0; round < rounds; round++) {
      const before = tally.crossings;
      for (const w of wires.filter((x) => x.visible && x.path.length > 2).sort((p, q) => q.path.length - p.path.length)) {
        if (w.path.length <= 2 || !spare(w, w) || !free(w)) continue;
        take(w);
        wires.splice(wires.indexOf(w), 1);
        through([w.link]);
      }
      if (tally.crossings >= before) break;
    }
  };

  return { through, tally, nearest, put, again, prune };
}

/** Invisible edges that each join two of `sets` round an item they share, no set twice, as many of them as stay planar. */
function manyAtOnce(sets, edges, worth) {
  const holders = new Map(), used = new Set(), tries = [];
  sets.forEach((s, i) => { for (const v of s) (holders.get(v) ?? holders.set(v, []).get(v)).push(i); });
  for (const [c, list] of holders) {
    const free = list.filter((i) => !used.has(i));
    for (let k = 1; k < free.length; k += 2) {
      const [i, j] = [free[k - 1], free[k]], a = [...sets[i]].find((v) => v !== c), b = [...sets[j]].find((v) => v !== c);
      if (a === undefined || b === undefined || a === b) continue;
      used.add(i).add(j);
      tries.push(worth(a, b) >= worth(b, a) ? [a, b, Boolean(worth(a, b))] : [b, a, Boolean(worth(b, a))]);
    }
  }
  return keptPlanar([...edges, ...tries]).kept.slice(edges.length).map(([a, b, leads]) => (leads ? [a, b, true] : [a, b]));
}

/**
 * Invisible edges until `kept` over `items` is one biconnected piece, each kept only if it stays planar, and each as far
 * as it can be from what the order leaves without a wire out to what it leaves without a wire in, so that it lends both.
 */
function join(kept, items, order) {
  const hidden = [], all = () => [...kept, ...hidden], from = new Set(order.map(([u]) => u)), into = new Set(order.map(([, v]) => v));
  const ends = new Set([...into].filter((v) => !from.has(v))), starts = new Set([...from].filter((v) => !into.has(v)));
  const worth = (a, b) => Number(ends.has(a)) + Number(starts.has(b));
  for (const k of items) if (!all().some(([u, v]) => u === k || v === k)) hidden.push([k, items.find((x) => x !== k)]);
  for (let round = 0; round < 2000; round++) {
    const parts = blocks(all());
    if (parts.length === 1) return hidden;
    const sets = parts.map((p) => new Set(p.flat())), together = (x, y) => sets.some((s) => s.has(x) && s.has(y));
    if (parts.length > MANY_PIECES) {
      const joined = manyAtOnce(sets, all(), worth);
      if (joined.length) { hidden.push(...joined); continue; }
    }
    const bridge = (i, j, c) => {
      const ways = [];
      for (const a of sets[i]) {
        if (a === c || sets[j].has(a)) continue;
        for (const b of sets[j]) if (b !== c && !sets[i].has(b) && !together(a, b)) ways.push(worth(a, b) >= worth(b, a) ? [a, b, worth(a, b)] : [b, a, worth(b, a)]);
      }
      // The sort keeps the order they were found in among equals.
      for (const [a, b, w] of ways.sort((p, q) => q[2] - p[2])) if (isPlanar([...all(), [a, b]])) return void hidden.push(w ? [a, b, true] : [a, b]), true;
      return false;
    };
    let done = false;
    for (let i = 0; i < parts.length && !done; i++) for (let j = i + 1; j < parts.length && !done; j++) {
      const c = [...sets[i]].find((v) => sets[j].has(v));
      if (c !== undefined) done = bridge(i, j, c) !== false && all().length > 0 && Boolean(hidden.length);
    }
    if (!done) for (let i = 0; i < parts.length && !done; i++) for (let j = i + 1; j < parts.length && !done; j++) if (![...sets[i]].some((v) => sets[j].has(v))) done = bridge(i, j) !== false;
    if (!done) return hidden;
  }
  return hidden;
}

/**
 * `links` is a list of [u, v], heaviest first: the graph as { faces, wires, owner, ghosts, crossings }. The heaviest planar
 * part is kept, invisible edges join it into one biconnected piece and the links left out are threaded through its
 * faces. A wire is { path, visible, link }, its path from u to v through the points where it crosses; `owner` says which
 * wire holds each stretch between two neighbours.
 */
export function planarize(links, items) {
  const { kept, left } = keptPlanar(links);
  const edges = kept.map(([u, v]) => [u, v]), hidden = join(edges, items, links.filter((l) => l[2]));
  const wires = [], owner = new Map();
  const add = (path, visible, link) => {
    const w = { path, visible, link };
    wires.push(w);
    for (let i = 1; i < path.length; i++) owner.set(pair(path[i - 1], path[i]), w);
  };
  kept.forEach((l) => add([l[0], l[1]], true, l));
  for (const [u, v, leads] of hidden) if (!owner.has(pair(u, v))) (add([u, v], false, null), (wires.at(-1).leads = leads));
  const list = faces([...owner.keys()].map((k) => k.split('|')));
  if (!list) throw new Error('The kept part is not planar');
  const { through, tally } = threader(list, owner, add, { number: new Map() });
  through(left);
  return { faces: list, wires, owner, ...tally };
}
