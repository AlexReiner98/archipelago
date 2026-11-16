// The faces of a threading, kept by stretch as they change, and the search across them (./thread.js): each face knows
// its stretches' names and the lists it sits in, and what the search under way knows of it, so neither is looked up
// in a map by face (task e_yztbb9s3). Layer: topology. Pure: faces in, changed in place.

import { pair } from './polyline.js';

/**
 * The faces waiting in a search, taken as `nextOf` (./thread.js) takes them from a list: the least `dist`, then the least `reach`,
 * then the one put in first; a face put in again while it waits keeps its first place, and is taken once for each time
 * it was put in. A heap of the faces, each with the turns it was put in at (bug e_a9w5jeme: the list was searched whole
 * at every step). `entries` is how long that list would be. What it knows of a face is in the face's record (`seatOf`).
 */
export function queueOf(mark) {
  const heap = [];
  let made = 0, entries = 0;
  const less = (f, g) => {
    const p = f[SEAT], q = g[SEAT];
    if (p.dist !== q.dist) return p.dist < q.dist;
    if (p.reach !== q.reach) return p.reach < q.reach;
    return p.turns[0] < q.turns[0];
  };
  const place = (f, i) => ((heap[i] = f), (f[SEAT].at = i));
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      const f = heap[i];
      (place(heap[p], i), place(f, p), (i = p));
    }
  };
  const down = (i) => {
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < heap.length && less(heap[l], heap[m])) m = l;
      if (r < heap.length && less(heap[r], heap[m])) m = r;
      if (m === i) return;
      const f = heap[i];
      (place(heap[m], i), place(f, m), (i = m));
    }
  };
  return {
    get size() { return heap.length; },
    get entries() { return entries; },
    /** `f`, its `dist` and `reach` already set for this search. */
    push(f) {
      entries++;
      const known = f[SEAT], list = known.turns;
      if (list.length) return void (list.push(made++), up(known.at));
      list.push(made++);
      place(f, heap.length);
      up(heap.length - 1);
    },
    pop() {
      const f = heap[0], list = f[SEAT].turns;
      entries--;
      list.shift();
      if (list.length) down(0);
      else {
        const last = heap.pop();
        if (heap.length) (place(last, 0), down(0));
      }
      return f;
    },
  };
}

// What a face carries beyond its points and their names, one record under a key of its own that no listing of the
// face shows, so a face compares and reads as it always did (task e_yztbb9s3: these were maps by face). Seated, the
// lists it sits in (`seats`) and whose they are (`seating`); searched, the search's number (`mark`), `dist`, `reach`,
// the face it was reached `from` and `via` which stretch, its place and turns in the queue, and whether it is at
// either end (`atU`, `atV`, as the search's number). One record a face, made afresh for each search.
const SEAT = Symbol('seat');
/** `f`'s record, made the first time it is asked for. */
export const seatOf = (f) => {
  const known = f[SEAT];
  if (known) return known;
  const made = { seats: null, seating: null, mark: 0, dist: undefined, reach: 0, at: -1, turns: [], from: null, via: null, atU: 0, atV: 0 };
  Object.defineProperty(f, SEAT, { value: made });
  return made;
};
let searches = 0;
/** A number no search before has had. */
export const nextSearch = () => ++searches;
/** What search `mark` knows of `f`: nothing yet, where it is another search's. */
export const searched = (f, mark) => {
  const known = seatOf(f);
  if (known.mark === mark) return known;
  (known.mark = mark), (known.dist = undefined), (known.reach = 0), (known.at = -1), (known.turns.length = 0), (known.from = known.via = null);
  return known;
};

/** The faces of `list` by stretch, kept true as they change. `name` is `pair`, remembered: it is asked for very often. */
export function seating(list) {
  const names = new Map(), seat = new Map(), ends = new Map();
  const name = (a, b) => {
    const of = names.get(a) ?? names.set(a, new Map()).get(a);
    let e = of.get(b);
    if (e === undefined) {
      of.set(b, (e = pair(a, b)));
      (names.get(b) ?? names.set(b, new Map()).get(b)).set(a, e);
    }
    return e;
  };
  // A face seated keeps its stretches' names (`names`, in turn round it) and the lists it sits in (`seats`, the same
  // turn) until it leaves, and its points stay as they are while it is seated: so a face changed by a point is given
  // both from those it had, not named and looked up again (task e_yztbb9s3). `seating` says whose lists they are.
  // A stretch's list carries its two ends (`ends`, as `endsOf` gives them) once a search has asked, so it reads them off it.
  const endsOf = (e) => ends.get(e) ?? ends.set(e, e.split('|')).get(e);
  const token = {}, listOf = (e) => seat.get(e) ?? seat.set(e, Object.assign([], { ends: null })).get(e);
  const sit = (f, given = f.map((a, k) => name(a, f[(k + 1) % f.length])), lists = given.map(listOf)) => {
    const held = seatOf(f);
    (f.names = given), (held.seats = lists), (held.seating = token);
    for (const s of lists) s.push(f);
  };
  const mine = (f) => f[SEAT]?.seating === token;
  const leave = (f) => { for (const s of mine(f) ? f[SEAT].seats : f.names.map((e) => seat.get(e))) s.splice(s.indexOf(f), 1); };
  /** Names and lists in turn, [names, lists]: of each part, `f`'s stretches from its `m`th to before its `n`th ([m, n]), or a stretch by its name. */
  const kept = (f, parts) => {
    const names = [], lists = [];
    for (const part of parts) {
      if (typeof part === 'string') (names.push(part), lists.push(listOf(part)));
      else for (let k = part[0]; k < part[1]; k++) (names.push(f.names[k]), lists.push(f[SEAT].seats[k]));
    }
    return [names, lists];
  };
  list.forEach((f) => sit(f));
  return {
    name,
    /** A stretch's two points, as its name gives them: split the first time it is asked, not each time. */
    ends: endsOf,
    of: (e) => seat.get(e) ?? [],
    /** Whether `f` sits in these lists: its `seats` are then the lists `of` gives, stretch by stretch. */
    mine,
    /** `f` in `list` given way to `pieces`. */
    swap(f, ...pieces) { leave(f); list.splice(list.indexOf(f), 1, ...pieces); pieces.forEach((p) => sit(p)); },
    /** `f` given way to its two sides of a new stretch from its `m`th point to its `n`th, `m` before `n`. */
    split(f, m, n) {
      const one = f.slice(m, n + 1), two = [...f.slice(n), ...f.slice(0, m + 1)];
      if (!mine(f)) return this.swap(f, one, two);
      const [oneNames, oneLists] = kept(f, [[m, n], name(f[n], f[m])]), [twoNames, twoLists] = kept(f, [[n, f.length], [0, m], name(f[m], f[n])]);
      leave(f);
      list.splice(list.indexOf(f), 1, one, two);
      sit(one, oneNames, oneLists);
      sit(two, twoNames, twoLists);
    },
    /** The point `d` on the stretch `a` to `b`, in each face it runs along. */
    within(a, b, d) {
      const e = name(a, b);
      for (const f of [...seat.get(e)]) {
        const k = f.names.indexOf(e), ok = k >= 0 && mine(f);
        const [names, lists] = ok ? kept(f, [[0, k], name(f[k], d), name(d, f[(k + 1) % f.length]), [k + 1, f.length]]) : [];
        leave(f);
        f.splice(k + 1, 0, d);
        if (!ok) sit(f);
        else sit(f, names, lists);
      }
    },
    /**
     * The faces either side of the stretch `p` to `q`, `f` from q round to p and `g` from p round to q, given way to the
     * one face they make without it: its stretches' names and lists are theirs. Answers false, changing nothing, where
     * the two are one or not seated here.
     */
    join(f, g, p, q) {
      if (f === g || !mine(f) || !mine(g)) return false;
      const one = roundWay(f, q, p), two = roundWay(g, p, q), joined = [...one.points, ...two.points.slice(1, -1)];
      const names = [], lists = [];
      for (const k of one.stretches) (names.push(f.names[k]), lists.push(f[SEAT].seats[k]));
      for (const k of two.stretches) (names.push(g.names[k]), lists.push(g[SEAT].seats[k]));
      this.swap(g);
      leave(f);
      list.splice(list.indexOf(f), 1, joined);
      sit(joined, names, lists);
      return true;
    },
    /** The point `d` out of its faces, the stretch through it one again: `near`, d's neighbours, find its faces. */
    without(d, near) {
      const at = new Set();
      for (const w of near) for (const f of seat.get(name(d, w)) ?? []) at.add(f);
      for (const f of list.filter((p) => at.has(p))) {
        const k = f.indexOf(d), n = f.length, ok = n > 2 && mine(f), joined = name(f[(k + n - 1) % n], f[(k + 1) % n]);
        const [names, lists] = !ok ? [] : k ? kept(f, [[0, k - 1], joined, [k + 1, n]]) : kept(f, [[1, n - 1], joined]);
        leave(f);
        f.splice(k, 1);
        if (!ok) sit(f);
        else sit(f, names, lists);
      }
    },
    /** Every face of `list` seated afresh, once `list` has been put back as it was. */
    reseat() { seat.clear(); list.forEach((f) => sit(f)); },
  };
}

/** The way round `f` from `a` to `b`, away from the stretch that joins them. */
export const roundFace = (f, a, b) => roundWay(f, a, b).points;

/** `roundFace`, with the place in `f` of each stretch it passes (`stretches`), in turn. */
export function roundWay(f, a, b) {
  const n = f.length, at = f.indexOf(a), step = f[(at + 1) % n] === b ? n - 1 : 1, points = [], stretches = [];
  for (let k = at; f[k] !== b; k = (k + step) % n) (points.push(f[k]), stretches.push(step === 1 ? k : (k + step) % n));
  points.push(b);
  return { points, stretches };
}