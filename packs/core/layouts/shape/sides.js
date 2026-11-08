// Which side of its box each wire should leave by (task e_7vp7udzk): a wire of the order leaves the foot of its upper box
// and comes into the head of its lower one, a turned wire leaves and comes in on the right, and a tie may go anywhere.
// The sides run clockwise round a box in the order its rotation has, so where the rotation will not let every wire have
// its side, the fewest go without: those, and the ties, are left for the bends to choose. Layer: shape. Pure: ends in,
// sides out.

/** The four sides, clockwise from the head of a box, as headings: a wire that leaves by a side leaves going that way. */
export const SIDES = ['N', 'E', 'S', 'W'];
export const QUARTERS = SIDES.length;
const N = SIDES.indexOf('N'), E = SIDES.indexOf('E'), S = SIDES.indexOf('S');

/** The side an end of edge `e` asks for at node `id`: S where the order leaves it, N where it comes in, E if turned. */
export function wanted(e, id) {
  if (e.dir === 'up') return E;
  if (e.dir === 'down') return e.from === id ? S : N;
  return null;
}

/**
 * Sides for the ends round one box, `asks` their wanted sides in clockwise order (null where any will do). Answers
 * { start, side, kept }: from `start`, the sides run clockwise without turning back; `side[i]` is the side of end i and
 * `kept[i]` whether it is the side asked for. Of equal answers, the first start and the earliest sides.
 */
export function sidesOf(asks) {
  const d = asks.length;
  if (!d) return { start: 0, side: [], kept: [] };
  let best = null;
  for (let start = 0; start < d; start++) {
    // cost[k][s]: the fewest ends without their side among the first k from start, the kth on side s.
    const cost = [], from = [];
    for (let k = 0; k < d; k++) {
      const ask = asks[(start + k) % d];
      cost.push([]); from.push([]);
      for (let s = 0; s < QUARTERS; s++) {
        const miss = ask !== null && ask !== s ? 1 : 0;
        let low = k ? Infinity : 0, at = -1;
        if (k) for (let p = 0; p <= s; p++) if (cost[k - 1][p] < low) { low = cost[k - 1][p]; at = p; }
        cost[k][s] = low + miss;
        from[k][s] = at;
      }
    }
    const last = cost[d - 1].reduce((m, c, s) => (c < cost[d - 1][m] ? s : m), 0);
    if (best && cost[d - 1][last] >= best.cost) continue;
    const side = new Array(d);
    for (let k = d - 1, s = last; k >= 0; s = from[k][s], k--) side[(start + k) % d] = s;
    best = { cost: cost[d - 1][last], start, side };
  }
  return { start: best.start, side: best.side, kept: best.side.map((s, i) => asks[i] !== null && asks[i] === s) };
}

export { N, E, S };
