// The relaxation (step 3, task e_7et8f4uv): every number of ./atoms.js moved at once, toward short wires and spacing as
// even as the shape's grid, while every distance of ./order.js is kept. Each round takes a step down the cost (a
// stress: each wire's stretches pulled short, each end toward the middle of its box's side, each pair that sees one
// another drawn to its least distance, each number held toward where the grid put it) and then gives way to every
// distance; the last round keeps each one exactly. Each round is told (`round(r, numbers, phase)`: the `grid`, its
// `room` given, a `relax` round, every distance `kept`), so the relaxation can be watched. Layer: metrics. Pure but for the one listener.

/** The cost's terms on one axis: pulls between two roots ([p, q, by, weight]: q - p toward by) and holds toward a place;
 *  a shore (`loose`) is held nowhere and drawn in to what it holds (`tight`) as a wire is drawn short. */
function costOf(n, { stretches, centred, rigid, order, tight = [], loose = new Set() }, start, w) {
  const pulls = [...stretches.map(([p, q, by]) => [p, q, by, w.pull]), ...centred.map(([p, q, by]) => [p, q, by, w.center]), ...rigid.map(([p, q, by]) => [p, q, by, w.rigid]), ...order.map(([p, q, l]) => [p, q, l, w.even]), ...tight.map(([p, q, l]) => [p, q, l, w.pull])];
  return { pulls, holds: start.map((v, k) => [v, loose.has(k) ? 0 : w.hold]), n };
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

/** The arcs that close a loop of the pushes behind each number (`from`: the arc that last pushed it), or null. */
function loopIn(n, from) {
  const mark = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    if (mark[s]) continue;
    let v = s;
    while (v !== undefined && !mark[v]) ((mark[v] = s + 1), (v = from[v]?.[0]));
    if (v === undefined || mark[v] !== s + 1) continue;
    const loop = [];
    let u = v;
    do ((loop.push(from[u]), (u = from[u][0]))); while (u !== v);
    return loop;
  }
  return null;
}

/**
 * The distances with none that contradict: where a loop of them asks a number to stand past itself (a shape whose
 * island holds less than it should, say), a box's cap in that loop is loosened first (the box grows to what the order needs), else the longest
 * distance of the order (a bound only where the loop holds nothing else), so the push at the end stays near and nothing runs off. Answers what is kept, how many distances were let go and how many caps.
 */
export function untangled(n, order, bounds, near, caps = []) {
  const at = new Array(n).fill(0), from = new Array(n), out = new Set(), arcs = [...caps, ...order, ...bounds], bound = new Set(bounds), cap = new Set(caps);
  for (let moved = true; moved; ) {
    moved = false;
    for (const e of arcs) if (!out.has(e) && at[e[0]] + e[2] > at[e[1]] + near) ((at[e[1]] = at[e[0]] + e[2]), (from[e[1]] = e), (moved = true));
    const loop = moved && loopIn(n, from);
    if (!loop) continue;
    const capped = loop.filter((e) => cap.has(e)), ours = loop.filter((e) => !bound.has(e)), among = capped.length ? capped : ours.length ? ours : loop;
    const drop = among.reduce((p, q) => (q[2] > p[2] ? q : p));
    out.add(drop);
    for (const e of loop) from[e[1]] = undefined;
  }
  const keep = (list) => list.filter((e) => !out.has(e)), kept = [...keep(caps), ...keep(order), ...keep(bounds)];
  // A cap let go comes back as wide as the order makes the box, no wider: the longest way from its low side to its high.
  const loosened = caps.filter((e) => out.has(e)).map(([hi, lo]) => {
    const far = new Array(n).fill(-Infinity);
    far[lo] = 0;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [p, q, l] of kept) if (far[p] + l > far[q] + near) ((far[q] = far[p] + l), (moved = true));
    }
    const e = [hi, lo, -far[hi]];
    kept.push(e);
    return e;
  });
  return { order: keep(order), bounds: keep(bounds), caps: [...keep(caps), ...loosened], dropped: out.size - loosened.length, uncapped: loosened.length };
}

/**
 * Both axes relaxed together. `axes[a]` is { n, start, stretches, centred, rigid, order, bounds }: how many numbers, where the
 * grid puts each, the stretches along the axis ([p, q, by]: q stands `by` from p when the stretch is nothing long), the
 * ends drawn to their sides' middles (`centred`, alike), each box drawn to its size (`rigid`), and the distances. `z` holds the weights (`pull`, `center`,
 * `rigid`, `even`, `hold`), the `step`, how many `rounds` and `sweeps`, the move under which it is `still`, how short a
 * distance may be left (`near`), and how often a round is told (`every`). Answers each axis's numbers, what could
 * not be kept, and how many distances contradicted others and were let go (`dropped`), and how many boxes the order makes longer than their size (`uncapped`).
 */
export function relaxed(given, z, round = () => {}) {
  const told = { rounds: 0, short: 0, unkept: 0, dropped: 0, uncapped: 0 };
  const axes = given.map((ax) => {
    const u = untangled(ax.n, ax.order, ax.bounds, z.near, ax.caps ?? []);
    ((told.dropped += u.dropped), (told.uncapped += u.uncapped));
    return { ...ax, order: u.order, bounds: [...u.bounds, ...u.caps] };
  });
  const at = axes.map((ax) => [...ax.start]), costs = axes.map((ax) => costOf(ax.n, ax, ax.start, z));
  const arcs = axes.map((ax) => [...ax.order, ...ax.bounds]);
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
