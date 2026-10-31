// A graph embedded so the order runs down (Eiglsperger, Eppinger and Kaufmann's mixed upward planarization): items on a
// line in an order that keeps the order's own, each link to the left or the right of it where it fits (Goldschmidt and
// Takvorian), and hidden links until one item starts it all and one ends it. Every link then runs from earlier to later
// in that numbering, so a drawing that follows the numbers runs every one of them down. Links that do not fit are
// threaded through the faces, each one way through the numbers: the order's wires onward, the others from whichever end
// comes first. What holds nothing then goes, and what crosses is threaded again the shortest way. Pure: links in, a graph out.

import { threader } from './thread.js';
import { pair } from './polyline.js';

/** How many orders are tried, and how much work they may take in all, in pairs of links compared. */
const TRIES = 24, WORK = 3e5;
/** How many times what is threaded is threaded again. */
const TIGHTEN = 3;

const ties = (p, q, r, s) => (p < r && r < q && q < s) || (r < p && p < s && s < q);

/** Items in an order where all the order's links run forward, each as near as it can be to what it is joined to. */
function lineUp(items, links, noise) {
  const near = new Map(items.map((v) => [v, new Set()])), after = new Map(items.map((v) => [v, []])), waits = new Map(items.map((v) => [v, 0]));
  for (const [u, v, order] of links) {
    near.get(u).add(v);
    near.get(v).add(u);
    if (order) (after.get(u).push(v), waits.set(v, waits.get(v) + 1));
  }
  const at = new Map(), line = [], ready = new Set(items.filter((v) => !waits.get(v)));
  while (ready.size) {
    let best, most = -Infinity;
    for (const v of ready) {
      let last = -1;
      for (const w of near.get(v)) if (at.has(w)) last = Math.max(last, at.get(w));
      const score = last * 100 - [...near.get(v)].filter((w) => !at.has(w)).length + noise() * 3;
      if (score > most) ((most = score), (best = v));
    }
    ready.delete(best);
    at.set(best, line.length);
    line.push(best);
    for (const w of after.get(best)) {
      waits.set(w, waits.get(w) - 1);
      if (!waits.get(w)) ready.add(w);
    }
  }
  return line;
}

/** The links that fit on the two sides of `line`, the order's first and short ones before long, and those that do not. */
function pages(line, links, noise) {
  const at = new Map(line.map((v, k) => [v, k])), sides = [[], []], left = [];
  const ranked = links.map((l) => ({ l, p: Math.min(at.get(l[0]), at.get(l[1])), q: Math.max(at.get(l[0]), at.get(l[1])) }));
  ranked.sort((a, b) => Number(b.l[2]) - Number(a.l[2]) || a.q - a.p - (b.q - b.p));
  for (const arc of ranked) {
    const free = [0, 1].filter((k) => !sides[k].some((o) => ties(arc.p, arc.q, o.p, o.q)));
    if (!free.length) { left.push(arc.l); continue; }
    const k = free.length > 1 ? (noise() < 0.5 ? 0 : 1) : free[0];
    sides[k].push(arc);
  }
  return { at, sides, left };
}

/** The numbering's start and end, and hidden arcs until nothing else starts or ends: each hugs the arc it sits under. */
function close(line, sides) {
  const last = line.length - 1, hidden = [], enters = new Set(), leaves = new Set();
  for (const { p, q } of sides.flat()) (leaves.add(p), enters.add(q));
  const whole = sides.flat().find((a) => a.p === 0 && a.q === last);
  const stHere = whole ? (sides[1].includes(whole) ? 1 : 0) : 1;
  const put = (k, p, q) => { const arc = { p, q, hidden: true }; sides[k].push(arc); hidden.push(arc); leaves.add(p); enters.add(q); };
  if (!whole) put(1, 0, last);
  for (let v = 1; v <= last; v++) {
    if (enters.has(v)) continue;
    const best = [0, 1].map((k) => sides[k].filter((o) => o.p < v && v < o.q).reduce((m, o) => (!m || o.p > m.p ? o : m), null));
    const k = !best[0] ? 1 : !best[1] ? 0 : best[0].q - best[0].p <= best[1].q - best[1].p ? 0 : 1;
    put(k, best[k].p, v);
  }
  for (let v = last - 1; v >= 0; v--) {
    if (leaves.has(v)) continue;
    const best = [0, 1].map((k) => sides[k].filter((o) => o.p < v && v < o.q).reduce((m, o) => (!m || o.q < m.q ? o : m), null));
    const k = !best[0] ? 1 : !best[1] ? 0 : best[0].q - best[0].p <= best[1].q - best[1].p ? 0 : 1;
    put(k, v, best[k].q);
  }
  return { hidden, stHere };
}

/** The faces of the two sides, each a cycle keeping its face on its left as it goes. */
function facesOf(line, sides) {
  const round = line.map(() => [[], [], [], []]);
  sides.forEach((arcs, k) => {
    for (const { p, q } of arcs) (round[p][k ? 1 : 2].push(q), round[q][k ? 0 : 3].push(p));
  });
  // Clockwise from above: the right side in, the right side out, the left side out, the left side in.
  const clock = round.map(([ri, ro, lo, li]) => [...ri.sort((a, b) => b - a), ...ro.sort((a, b) => b - a), ...lo.sort((a, b) => a - b), ...li.sort((a, b) => a - b)]);
  const seen = new Set(), list = [];
  clock.forEach((around, u) => around.forEach((v) => {
    if (seen.has(`${u} ${v}`)) return;
    const f = [];
    for (let [a, b] = [u, v]; !seen.has(`${a} ${b}`); ) {
      seen.add(`${a} ${b}`);
      f.push(line[a]);
      const r = clock[b];
      [a, b] = [b, r[(r.indexOf(a) + 1) % r.length]];
    }
    list.push(f);
  }));
  return list;
}

/** One order of the items, tried through to the graph it makes. Only what the order touches goes on the line. */
function attempt(links, items, lean, noise) {
  const inOrder = new Set(links.filter((l) => l[2]).flatMap((l) => [l[0], l[1]]));
  const here = inOrder.size >= 3 ? new Set(items.filter((v) => inOrder.has(v))) : new Set(items);
  const onLine = links.filter(([u, v]) => here.has(u) && here.has(v)), later = links.filter(([u, v]) => !here.has(u) || !here.has(v));
  const line = lineUp([...here], onLine, lean), { sides, at, left } = pages(line, onLine, noise), last = line.length - 1, number = new Map(at);
  const lost = left.filter((l) => l[2]).length, reach = sides.flat().reduce((sum, a) => sum + a.q - a.p, 0), { hidden, stHere } = close(line, sides);
  const [s, t] = [line[0], line[last]], wires = [], owner = new Map();
  const add = (path, visible, link) => {
    const w = { path, visible, link };
    wires.push(w);
    for (let i = 1; i < path.length; i++) owner.set(pair(path[i - 1], path[i]), w);
    return w;
  };
  for (const arcs of sides) for (const a of arcs) if (a.l) add([a.l[0], a.l[1]], true, a.l);
  for (const a of hidden) add([line[a.p], line[a.q]], false, null);
  const list = facesOf(line, sides), run = stHere ? [s, t] : [t, s], keep = pair(s, t);
  const isOuter = (f) => f.some((v, k) => (v === run[0] && f[(k + 1) % f.length] === run[1]) || (v === run[1] && f[(k + 1) % f.length] === run[0]));
  // The order's wires first: one left for later must still find a way.
  const { through, tally, nearest, put, again, prune } = threader(list, owner, add, { number, keep, onward: (l) => l[2] > 0, oneWay: true });
  through([...left].sort((a, b) => Number(b[2]) - Number(a[2])));
  // Then what only has ties, each in the face nearest what it is tied to, the most tied first.
  const waiting = new Set(items.filter((v) => !here.has(v))), placed = (v) => !waiting.has(v);
  while (waiting.size) {
    let v, most = -1;
    for (const c of waiting) {
      const known = later.filter(([p, q]) => (p === c && placed(q)) || (q === c && placed(p))).length;
      if (known > most) ((most = known), (v = c));
    }
    const mine = later.filter(([p, q]) => (p === v && placed(q)) || (q === v && placed(p))), near = mine.map(([p, q]) => (p === v ? q : p));
    const at = near.map((w) => number.get(w)).sort((p, q) => p - q);
    put(v, nearest(near, isOuter), at[at.length >> 1] ?? 0);
    waiting.delete(v);
    through(mine);
  }
  return { faces: list, wires, owner, number, s, t, lost, reach, tally, tighten: () => { prune(wires); again(wires, TIGHTEN); }, outer: () => list.findIndex(isOuter) };
}

/**
 * `links` is a list of [u, v, order]: for the order, u comes first. The graph as thread's { faces, wires, owner, ghosts,
 * crossings }, with `number` for each item and point, its first and last `s` and `t`, and `outerAt`, the outer face.
 * Each order tried is judged by the crossings it comes to, not by how many links it keeps, and the best is tightened.
 */
export function embed(links, items) {
  let seed = 7, best = null;
  const noise = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const tries = Math.max(4, Math.min(TRIES, Math.ceil(WORK / Math.max(1, links.length * links.length))));
  for (let k = 0; k < tries && (!best || best.cost > 0); k++) {
    const made = attempt(links, items, k ? noise : () => 0, noise), cost = made.tally.crossings + made.tally.ghosts.length / 10;
    if (!best || cost < best.cost) best = { ...made, cost };
  }
  best.tighten();
  return { ...best, ...best.tally, outerAt: best.outer() };
}
