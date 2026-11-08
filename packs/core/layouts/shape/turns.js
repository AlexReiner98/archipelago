// Which way every end of every edge leaves its node, and how each edge turns between (task e_7vp7udzk). Tamassia's
// network (./angles.js) gives a shape only up to turning it round, and one box's head need not stand where another's
// does; so each node is turned to face the box nearest it whose sides are known, and then each edge's turns are what its
// two ends need, up to whole turns of four, which a second flow over the faces settles, the cheapest that closes every
// face. The angles at every node are kept: only bends change. Layer: shape. Pure: the shape in, headings and turns out.

import { minCostFlow } from './flow.js';
import { QUARTERS } from './sides.js';

/** What a quarter more or less on an edge costs: a wire's, and a border's, which must keep its corners. */
const BEND = 1, BORDER = 1e3;

/** Turns as a list, -1 left and 1 right: `n` of them, all one way. */
const run = (n) => Array.from({ length: Math.abs(n) }, () => Math.sign(n));

/**
 * The heading every dart leaves its tail with (`out`, N E S W as 0 to 3), the turns along every edge from its `from`
 * (`turns`), how many there are on wires (`bends`), and how many border edges turn otherwise than the shape had them
 * (`bent`), which leaves an island no rectangle.
 */
export function headings(emb, F, S) {
  const { tail, head, leaving, faceOf, faces, outerOf } = F, D = tail.length;
  const out = new Int8Array(D).fill(-1), nA = emb.edges.map((_, k) => S.rights[k] - S.lefts[k]);
  /** Turn node v so that the dart leaving along edge k leaves heading h. */
  const orient = (v, k, h) => {
    const ring = S.ringOf[v], i = ring.indexOf(k);
    for (let j = 0; j < ring.length; j++) {
      const kk = ring[(i + j) % ring.length], d = leaving(v, kk);
      out[d] = h;
      h = (h + S.angle[d ^ 1]) % QUARTERS;
    }
  };
  // Every box whose sides are known first, then outward from them, each node turned as its first neighbour leaves it.
  const queue = [];
  for (const [v, sides] of S.anchored) {
    const [k, side] = sides.entries().next().value ?? [];
    if (k === undefined) continue;
    orient(v, k, side);
    queue.push(v);
  }
  /** Turn the node across edge k from v as the shape has it, and if that node is on an island's border, the whole
   *  border with it: a border is turned round as one, so where two boxes disagree which way is up it falls on a wire
   *  between them, never on a border, which must stay a rectangle. */
  const follow = (v, k, onlyBorder) => {
    const d = leaving(v, k), u = head[d];
    if (out[d ^ 1] >= 0 || (onlyBorder && !S.border.has(k))) return;
    orient(u, k, (out[d] + (d % 2 === 0 ? nA[k] : -nA[k]) + 2 + QUARTERS * QUARTERS) % QUARTERS);
    queue.push(u);
    for (const kk of S.ringOf[u]) if (S.border.has(kk)) follow(u, kk, true);
  };
  const reach = () => {
    for (let q = 0; q < queue.length; q++) for (const k of S.ringOf[queue[q]]) follow(queue[q], k, false);
  };
  reach();
  for (let d = 0; d < D; d++) if (out[d] < 0) { orient(tail[d], d >> 1, 0); queue.push(tail[d]); reach(); }

  // Each edge's fewest turns that bring its first heading round to its last: -1, 0, 1 or 2.
  const base = emb.edges.map((_, k) => {
    const need = (out[k * 2 + 1] + 2) % QUARTERS, delta = (need - out[k * 2] + QUARTERS) % QUARTERS;
    return delta === QUARTERS - 1 ? -1 : delta;
  });
  // A face closes when its turns come to four, one way or the other; what is short is made up in whole turns of four.
  const outer = new Set(outerOf.values()), supply = faces.map(() => 0);
  faces.forEach((f, i) => {
    let sum = 0;
    for (const d of f) sum += S.angle[d] - 2 + (d % 2 === 0 ? base[d >> 1] : -base[d >> 1]);
    const short = (outer.has(i) ? QUARTERS : -QUARTERS) - sum;
    if (short % QUARTERS !== 0) throw new Error('shape: a face whose headings do not close');
    supply[i] = -short / QUARTERS;
  });
  const arcs = [], at = [];
  emb.edges.forEach((e, k) => {
    const f = faceOf[k * 2], g = faceOf[k * 2 + 1], c = base[k], w = S.border.has(k) ? BORDER : emb.unseen?.has(e.id) ? 0 : BEND;
    if (f === g) { at.push(null); return; }
    at.push(arcs.length);
    // A whole turn more (g to f) or less (f to g): the first costs what it changes, each further one four.
    arcs.push({ from: g, to: f, cap: 1, cost: w * (Math.abs(c + QUARTERS) - Math.abs(c)) });
    arcs.push({ from: g, to: f, cost: w * QUARTERS });
    arcs.push({ from: f, to: g, cap: 1, cost: w * (Math.abs(c - QUARTERS) - Math.abs(c)) });
    arcs.push({ from: f, to: g, cost: w * QUARTERS });
  });
  const { flow } = minCostFlow(faces.length, supply, arcs);
  const turns = [];
  let bends = 0, bent = 0;
  emb.edges.forEach((e, k) => {
    const a = at[k], n = base[k] + (a === null ? 0 : QUARTERS * (flow[a] + flow[a + 1] - flow[a + 2] - flow[a + 2 + 1]));
    turns.push(run(n));
    if (!S.border.has(k) && !emb.unseen?.has(e.id)) bends += Math.abs(n);
    if (S.border.has(k) && n !== nA[k]) bent++;
  });
  return { out, turns, bends, bent };
}
