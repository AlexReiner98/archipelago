// The planar graph of a part: what crosses what, how its faces lie, and the numbering that runs it down the page. Layer:
// topology. It holds no position. Pure: links in, a graph out.

import { FALL, RISE } from './graph.js';
import { numbered } from './numbering.js';
import { pair } from './polyline.js';
import { planarize } from './thread.js';
import { embed } from './upward.js';

/** Each stretch's face to its left and right, walking out from the outer face; each face's two sides. */
export function sidesOf(list, outerAt, number, s, t) {
  const byEdge = new Map();
  list.forEach((f, i) => f.forEach((a, k) => {
    const e = pair(a, f[(k + 1) % f.length]);
    (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(i);
  }));
  const chains = (f) => {
    const low = f.reduce((m, v, i) => (number.get(v) < number.get(f[m]) ? i : m), 0), n = f.length;
    const run = (step) => {
      const out = [];
      for (let i = low; ; i = (i + step + n) % n) {
        const j = (i + step + n) % n;
        out.push(pair(f[i], f[j]));
        if (number.get(f[j]) < number.get(f[i])) throw new Error('A face has more than one top');
        if (number.get(f[(j + step + n) % n]) < number.get(f[j]) || (j + step + n) % n === low) break;
      }
      return out;
    };
    return [run(1), run(-1)];
  };
  const left = new Map(), right = new Map(), LEFT = -1, RIGHT = -2, seen = new Set([outerAt]);
  const other = (e, i) => (byEdge.get(e) ?? []).find((f) => f !== i);
  const visit = (i, e, isRight) => {
    if (seen.has(i)) return;
    seen.add(i);
    const [a, b] = chains(list[i]), near = a.includes(e) ? a : b, far = near === a ? b : a;
    for (const x of near) (isRight ? right : left).set(x, i);
    for (const x of far) (isRight ? left : right).set(x, i);
    for (const x of near) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, !isRight); }
    for (const x of far) { const o = other(x, i); if (o !== undefined && o !== outerAt) visit(o, x, isRight); }
  };
  const st = pair(s, t), [a, b] = chains(list[outerAt]), [mine, rest] = a.length === 1 && a[0] === st ? [a, b] : [b, a];
  right.set(mine[0], RIGHT);
  for (const e of rest) left.set(e, LEFT);
  const inside = other(st, outerAt);
  visit(inside, st, false);
  for (const e of rest) { const o = other(e, outerAt); if (o !== undefined) visit(o, e, true); }
  for (const e of byEdge.keys()) if (!left.has(e) || !right.has(e)) throw new Error('A stretch has no side');
  return { left, right, LEFT, RIGHT };
}

/** What a part with ports must start and end with: its rise and top ports, its foot ports and fall, each side in its order. */
function portEnds(links, lines, mirror) {
  const tied = (end) => new Set(links.filter((l) => l[0] === end || l[1] === end).map((l) => (l[0] === end ? l[1] : l[0])));
  const [tops, foots] = [tied(RISE), tied(FALL)], ports = lines.flat(), side = mirror ? [...ports].reverse() : ports;
  return { first: [RISE, ...side.filter((p) => tops.has(p))], last: [...side.filter((p) => foots.has(p)), FALL] };
}

/** How many headed order wires run against `number`. */
export const against = (g, number) => g.wires.filter((w) => w.link?.[2] > 1 && w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v))).length;

/**
 * The part's graph and numbering. The heaviest planar part, numbered as the order asks, is the picture with the fewest
 * crossings; where that leaves order wires up, the embedding made for the order (./upward.js) is tried in its place. A
 * part too large for the search's trials starts from that embedding, and is numbered only if the embedding fails.
 */
export function downward(links, list, z, { ties = 0, nth = 0, embedded = false, madeAt, lines = [], mirror = false } = {}) {
  // By when each was made (`madeAt`, a step's place in that order: ./steps.js), so the picture does not change with the
  // order the answer came in and what was made first goes first: a link by its older end, then its newer, so of the
  // links from one step, one to a new step comes after the rest. Without it, by name. Ties in another fixed order keep
  // another planar part, for the search in `best`: by when made, the newer ends the other way.
  // Each link's ends by when made, worked out once: the sort asks for them at every comparison.
  const madeOf = madeAt && new Map(list.map((v) => [v, madeAt(v)])), endsOf = new Map();
  const ends = (l) => { let e = endsOf.get(l); if (!e) { const [a, b] = [madeOf.get(l[0]) ?? madeAt(l[0]), madeOf.get(l[1]) ?? madeAt(l[1])]; endsOf.set(l, (e = [Math.max(a, b), Math.min(a, b)])); } return e; };
  const byMade = (p, q) => { const [a, b] = [ends(p), ends(q)]; return a[1] - b[1] || (a[0] - b[0]) * (ties & 1 ? -1 : 1); };
  const keyOf = (l) => { const k = pair(l[0], l[1]); return ties === 1 ? [...k].reverse().join('') : ties === 2 ? k.slice(k.indexOf('|')) + k : k; };
  const name = madeAt ? byMade : (p, q) => (keyOf(p) < keyOf(q) ? -1 : 1) * (ties === 3 ? -1 : 1);
  const ids = madeAt ? [...list].sort((p, q) => madeOf.get(p) - madeOf.get(q)) : [...list].sort(), sorted = [...links].sort((p, q) => Number(q[2]) - Number(p[2]) || name(p, q));
  const asFound = (made) => ({ g: made, s: made.s, t: made.t, number: made.number, outerAt: made.outerAt });
  // A part past the trials has one way to be drawn, and numbering it takes longer than the rest of the picture.
  // An island's ports come first and last, under its rise and over its fall, in the order their wires come at sea (`lines`,
  // mirrored as the trial is): the numbering and the embedding both take them so.
  const ported = list.includes(RISE) || list.includes(FALL), held = ported ? portEnds(sorted, lines, mirror) : undefined;
  const big = list.length > z.trial_most, order = sorted.some((l) => l[2] > 1), fits = list.length <= z.embed_big;
  if (big && order && fits) {
    const made = embed(sorted, ids, held);
    if (!made.unthreaded && !against(made, made.number)) return asFound(made);
  }
  const g = planarize(sorted, ids, { lines, mirror }), found = { g, ...numbered(g, nth, big ? Infinity : z.number_tries) }, up = against(g, found.number);
  // The search gives only small parts a trial of the embedding: the first trial of a larger one tries it here.
  if (!up || !(embedded || (fits && list.length > z.embed_most && !ties && !nth))) return found;
  const made = embed(sorted, ids, held);
  return against(made, made.number) < up && made.crossings <= g.crossings + up * z.embed_cost ? asFound(made) : found;
}
