// The planar graph of a part: what crosses what, how its faces lie, and the numbering that runs it down the page. Layer:
// topology. It holds no position. Pure: links in, a graph out.

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

/** How many headed order wires run against `number`. */
export const against = (g, number) => g.wires.filter((w) => w.link?.[2] > 1 && w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v))).length;

/**
 * The part's graph and numbering. The heaviest planar part, numbered as the order asks, is the picture with the fewest
 * crossings; where that leaves order wires up, the embedding made for the order (./upward.js) is tried in its place.
 */
export function downward(links, list, z, { ties = 0, nth = 0, embedded = false } = {}) {
  // By name, so the picture does not change with the order the answer came in. Ties in another fixed order keep another
  // planar part, for the search in `best`.
  const keyOf = (l) => { const k = pair(l[0], l[1]); return ties === 1 ? [...k].reverse().join('') : ties === 2 ? k.slice(k.indexOf('|')) + k : k; };
  const name = (p, q) => (keyOf(p) < keyOf(q) ? -1 : 1);
  const ids = [...list].sort(), sorted = [...links].sort((p, q) => Number(q[2]) - Number(p[2]) || name(p, q) * (ties === 3 ? -1 : 1));
  const g = planarize(sorted, ids), found = { g, ...numbered(g, nth, list.length <= z.trial_most ? z.number_tries : Infinity) }, up = against(g, found.number);
  if (!embedded || !up) return found;
  const made = embed(sorted, ids);
  return against(made, made.number) < up && made.crossings <= g.crossings + up * z.embed_cost ? { g: made, s: made.s, t: made.t, number: made.number, outerAt: made.outerAt } : found;
}
