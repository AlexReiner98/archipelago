// The relaxation (step 3, task e_7et8f4uv): every number of ./atoms.js moved at once, toward short wires and spacing as
// even as the shape's grid, while every distance of ./order.js is kept. Each round takes a step down the cost (a
// stress: each wire's stretches pulled short, each end toward the middle of its box's side, each pair that sees one
// another drawn to its least distance, each number held toward where the grid put it) and then gives way to every
// distance; the last round keeps each one exactly. Each round is told (`round(r, numbers, phase)`: the `grid`, its
// `room` given, a `relax` round, every distance `kept`), so the relaxation can be watched. Layer: metrics. Pure but for the one listener.

/** The cost's terms on one axis: pulls between two roots ([p, q, by, weight]: q - p toward by) and holds toward a place. */
function costOf(n, { stretches, centred, rigid, order }, start, w) {
  const pulls = [...stretches.map(([p, q, by]) => [p, q, by, w.pull]), ...centred.map(([p, q, by]) => [p, q, by, w.center]), ...rigid.map(([p, q, by]) => [p, q, by, w.rigid]), ...order.map(([p, q, l]) => [p, q, l, w.even])];
  return { pulls, holds: start.map((v) => [v, w.hold]), n };
}

/** One step down the cost, each number by its own share (a damped Jacobi step), `step` of the way. */
function descend(at, { pulls, holds, n }, step) {
  const g = new Array(n).fill(0), h = new Array(n).fill(0);
  for (const [p, q, by, w] of pulls) {
    if (p === q) continue;
    const d = at[q] - at[p] - by;
    (g[q] += w * d), (g[p] -= w * d), (h[q] += w), (h[p] += w);
  }
  holds.forEach(([v, w], k) => ((g[k] += w * (at[k] - v)), (h[k] += w)));
  let most = 0;
  for (let k = 0; k < n; k++) if (h[k]) {
    const by = (step * g[k]) / h[k];
    at[k] -= by;
    most = Math.max(most, Math.abs(by));
  }
  return most;
}

/** Every distance given way to, both ends of each moving half, `sweeps` times or until none is short. */
function giveWay(at, arcs, sweeps, near) {
  let short = 0;
  for (let s = 0; s < sweeps; s++) {
    short = 0;
    for (const [p, q, l] of arcs) {
      const d = at[p] + l - at[q];
      if (d <= near) continue;
      (at[p] -= d / 2), (at[q] += d / 2), (short = Math.max(short, d));
    }
    if (!short) break;
  }
  return short;
}

/** Every distance kept exactly: each number that stands short pushed on, as few times as the arcs need; how many still are. */
function kept(at, arcs, passes, near) {
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const [p, q, l] of arcs) if (at[p] + l > at[q] + near) ((at[q] = at[p] + l), (moved = true));
    if (!moved) return 0;
  }
  return arcs.filter(([p, q, l]) => at[p] + l > at[q] + near).length;
}

/**
 * Both axes relaxed together. `axes[a]` is { n, start, stretches, centred, rigid, order, bounds }: how many numbers, where the
 * grid puts each, the stretches along the axis ([p, q, by]: q stands `by` from p when the stretch is nothing long), the
 * ends drawn to their sides' middles (`centred`, alike), each box drawn to its size (`rigid`), and the distances. `z` holds the weights (`pull`, `center`,
 * `rigid`, `even`, `hold`), the `step`, how many `rounds` and `sweeps`, the move under which it is `still`, how short a
 * distance may be left (`near`), and how often a round is told (`every`). Answers each axis's numbers and what could
 * not be kept.
 */
export function relaxed(axes, z, round = () => {}) {
  const at = axes.map((ax) => [...ax.start]), costs = axes.map((ax) => costOf(ax.n, ax, ax.start, z));
  const arcs = axes.map((ax) => [...ax.order, ...ax.bounds]);
  const told = { rounds: 0, short: 0, unkept: 0 };
  // The grid as given is told first, then the same given room: the relaxation starts from there.
  round(0, at, 'grid');
  at.forEach((v, a) => giveWay(v, arcs[a], z.sweeps, z.near));
  round(0, at, 'room');
  for (let r = 1; r <= z.rounds; r++) {
    let most = 0;
    for (let a = 0; a < 2; a++) {
      most = Math.max(most, descend(at[a], costs[a], z.step));
      told.short = giveWay(at[a], arcs[a], z.sweeps, z.near);
    }
    told.rounds = r;
    if (r % z.every === 0) round(r, at, 'relax');
    if (most < z.still) break;
  }
  at.forEach((v, a) => (told.unkept += kept(v, arcs[a], z.sweeps * 4, z.near)));
  round(told.rounds, at, 'kept');
  return { at, told };
}
