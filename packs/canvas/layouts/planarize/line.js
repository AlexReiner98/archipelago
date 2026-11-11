// Every step on one line, the numbering the picture runs down by, with each island a run of it of its own (task
// e_snvzsxj4): its top and a second top, then what lives on it, then its foot. Its border is three arcs on that line,
// from its top round the left to its foot and from its foot round the right to the second top, then back to the top,
// so what stands between its tops and its foot is inside it and nothing else is. The islands and what lives at sea are
// put in order first, as one step each, every ring among them broken by turning the fewest wires (./direct.js), and
// moved to where the wires between them interleave least (./sift.js); each island's own steps keep their order.
// Layer: topology. Pure: wires in, a line out.

import { feedback } from './direct.js';
import { sifted, siftedWithin } from './sift.js';
import { lineUp } from './upward.js';

export const topOf = (island) => `top ${island}`, secondOf = (island) => `top2 ${island}`, footOf = (island) => `foot ${island}`;
/** Whether a node is one of a border's own. */
export const isBorder = (id) => /^(top|top2|foot) /.test(id);

/** A border arc as the threader takes it: [a, b], marked with the island it rings and which of its three arcs it is. */
const arc = (a, b, island, side) => Object.assign([a, b], { border: island, side });

/** The border of `island`: its three arcs in turn round it, the first on the left page and the other two on the right, so the loop is closed. */
export function borderArcs(island) {
  const [t, s, f] = [topOf(island), secondOf(island), footOf(island)];
  return [arc(t, f, island, 0), arc(f, s, island, 1), arc(s, t, island, 2)];
}

/**
 * The line: `wires` (each with `top` and `foot`, of ./direct.js, and `firm` where it must run down), `placeOf(id)` where
 * each step lives (null at sea), `made(id)` when it was made, `rounds` how many times the runs and each island's steps
 * are sifted by what reads across (./sift.js), `noise(id)` how each step leans (none by default), `within` whether each
 * island's own steps are sifted too (the first start's are; a start that leans is left so, for a line of its own). Answers the line, top
 * first, and the wires with their ways set again: a wire between islands that would run against the islands' order is turned.
 */
export function lineOf(ids, wires, placeOf, made, rounds = 0, noise = () => 0, within = true) {
  const unit = (v) => (placeOf(v) === null ? v : `island ${placeOf(v)}`);
  const units = [...new Set(ids.map(unit))], madeOf = new Map();
  for (const v of ids) madeOf.set(unit(v), Math.min(madeOf.get(unit(v)) ?? Infinity, made(v)));
  const between = wires.filter((w) => w.firm && unit(w.top) !== unit(w.foot)).map((w) => ({ w, u: unit(w.top), v: unit(w.foot), directed: true }));
  const { turned } = feedback(units, between, (u) => madeOf.get(u));
  const turnAgain = new Set([...turned].map((b) => b.w));
  const ways = wires.map((w) => (turnAgain.has(w) ? { ...w, top: w.foot, foot: w.top, turned: !w.turned, byIslands: true } : w));
  const linked = (keep) => ways.filter((w) => keep(w)).map((w) => (w.firm ? [w.top, w.foot, true] : [w.u, w.v]));
  // The islands and the sea's steps in order, each island as one; then each island's own.
  const quotient = new Map();
  for (const w of ways) {
    const [a, b] = [unit(w.firm ? w.top : w.u), unit(w.firm ? w.foot : w.v)];
    if (a !== b && !quotient.get(`${a} ${b}`)?.[2]) quotient.set(`${a} ${b}`, [a, b, Boolean(w.firm)]);
  }
  const firm = [...quotient.values()].filter((q) => q[2]), ends = ways.map((w) => [w.u, w.v]), inner = ways.filter((w) => w.firm).map((w) => [w.top, w.foot]);
  const byMade = [...units].sort((p, q) => madeOf.get(p) - madeOf.get(q));
  const runOf = (u) => {
    if (!u.startsWith('island ')) return [u];
    const island = u.slice('island '.length), own = ids.filter((v) => placeOf(v) === island).sort((p, q) => made(p) - made(q));
    const set = new Set(own), inside = linked((w) => set.has(w.u) && set.has(w.v));
    return [topOf(island), secondOf(island), ...lineUp(own, inside, noise), footOf(island)];
  };
  const runs = new Map(units.map((u) => [u, runOf(u)]));
  // Then each moved to where what reads across interleaves least (./sift.js), its own steps in their order; then each
  // island's own steps moved within it the same way, the wires that leave it counted too (task e_wayfga4d).
  const line = sifted(lineUp(byMade, [...quotient.values()], noise), (u) => runs.get(u), ends, firm, rounds).flatMap((u) => runs.get(u));
  if (within) siftedWithin(line, (v) => (isBorder(v) ? null : placeOf(v)), ends, inner, rounds);
  return { line, wires: ways };
}
