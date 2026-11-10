// The relaxation solved exactly (bug e_a9w5jeme): each cost of ./solve.js counted in whole pixels off (L1, not squared),
// which makes it a minimum-cost tension, the dual of a minimum-cost flow (./flow.js): the best places at once, where the
// rounds of ./solve.js may stop short. Layer: metrics. Pure: numbers in, numbers out.

import { minCostFlow } from './flow.js';

/**
 * Places for `n` numbers minimising Σ w·|x[q] - x[p] - by| over `soft` ([p, q, by, w]) with x[q] - x[p] ≥ l kept for
 * every one of `hard` ([p, q, l]), lengths taken in whole pixels. Each soft term is two arcs of capacity w (p→q costing
 * by, q→p costing -by), each hard one an arc q→p with no limit costing -l; potentials from the hard arcs alone make
 * those costs non-negative, and a soft arc still below nothing is run full first. The places are the shortest paths
 * over what the flow leaves, in the costs as they were. A weight is counted in `grain` whole units a unit (the flow
 * carries whole units). A least distance is taken down to a whole pixel (within `near`), so no loop of them asks for
 * more than it can hold (taken up, two of +0.3 and -0.3 made a loop of +1 and the flow ran on 52 million units); the
 * last pass of ./solve.js keeps each exactly. `batch` is as ./flow.js takes it.
 */
export function exactly(n, softIn, hardIn, grain, near, batch = 0) {
  const soft = softIn.map(([p, q, by, w]) => [p, q, Math.round(by), w]), hard = hardIn.map(([p, q, l]) => [p, q, Math.floor(l + near)]);
  const pi = new Array(n).fill(0);
  for (let round = 0, changed = true; changed && round <= n; round++) {
    changed = false;
    for (const [p, q, l] of hard) if (pi[q] - l < pi[p]) ((pi[p] = pi[q] - l), (changed = true));
  }
  const supply = new Array(n).fill(0), arcs = [], cost = [];
  const put = (from, to, cap, c) => {
    const rc = c + pi[from] - pi[to];
    if (rc < 0) ((supply[from] -= cap), (supply[to] += cap), arcs.push({ from: to, to: from, cap, cost: -rc }), cost.push(-c));
    else (arcs.push({ from, to, cap, cost: rc }), cost.push(c));
  };
  for (const [p, q, by, w] of soft) {
    if (p === q || !w) continue;
    const units = Math.max(1, Math.round(w * grain));
    (put(p, q, units, by), put(q, p, units, -by));
  }
  const given = supply.reduce((s, g) => s + Math.max(0, g), 0);
  for (const [p, q, l] of hard) put(q, p, given + 1, -l);
  const { flow } = minCostFlow(n, supply, arcs, { batch });
  const left = [];
  arcs.forEach((a, i) => {
    if (flow[i] < a.cap) left.push([a.from, a.to, cost[i]]);
    if (flow[i] > 0) left.push([a.to, a.from, -cost[i]]);
  });
  const x = pi.slice();
  for (let round = 0, changed = true; changed && round <= n; round++) {
    changed = false;
    for (const [a, b, c] of left) if (x[a] + c < x[b]) ((x[b] = x[a] + c), (changed = true));
  }
  return x;
}
