// A step put by hand is a pin: what it asks of the picture is one more thing the solve holds. Its box and what hangs on it go
// where they were put, its wires are given their way as every wire is (./shape.js), and the solve keeps every distance round
// what is held, so what stood there makes room. A drag frame, a release and a reload are this one call. Layer: metrics.
// Pure: pins in, places and lines out, the last worked out kept for the same pins.

import { settle } from './solve.js';

/** `line` with its first point moved by `d`: the stretch that leaves it goes along, and what comes next takes up the difference. */
function carry(line, d) {
  const l = line.map((p) => [...p]), along = l[0][0] === l[1][0] ? 1 : 0, across = 1 - along;
  l[0] = [l[0][0] + d[0], l[0][1] + d[1]];
  if (l.length > 2) {
    l[1][across] += d[across];
    return l;
  }
  const mid = (l[0][along] + l[1][along]) / 2, bend = (from) => { const p = []; p[across] = from[across]; p[along] = mid; return p; };
  return [l[0], bend(l[0]), bend(l[1]), l[1]];
}

/**
 * `x`, `y`, `nodes` and `routes` are what the solve left, by item and by link; `rigid` says what `hangs` on an item, and
 * `reshape(x, y, lines)` gives each line not marked `stays` its way. Answers with what the picture is for any pins:
 * `pinned(placed)` gives the places, the items that moved and the lines changed, by link.
 */
export function pinner({ nodes, x, y, routes, rigid, lengths, reshape }) {
  const wires = [...routes].filter(([, r]) => r.points.length > 1).map(([k, r]) => { const [p, q] = k.split('|'); return { k, a: r.from, b: r.from === p ? q : p, points: r.points }; });
  let last = null;
  return (placed) => {
    const hand = Object.keys(placed ?? {}).filter((id) => x.has(id) && Array.isArray(placed[id])).sort(), shift = new Map();
    for (const id of hand) {
      const d = [Number(placed[id][0]) - x.get(id), Number(placed[id][1]) - y.get(id)];
      if (!d[0] && !d[1]) continue;
      shift.set(id, d);
      for (const kid of rigid.get(id)?.hangs ?? []) if (!Array.isArray(placed[kid])) shift.set(kid, d);
    }
    if (!shift.size) return { x: new Map(x), y: new Map(y), moved: shift, lines: new Map() };
    const sign = JSON.stringify([...shift]);
    if (last?.sign === sign) return last.made;
    const X = new Map(x), Y = new Map(y);
    for (const [id, [dx, dy]] of shift) (X.set(id, x.get(id) + dx), Y.set(id, y.get(id) + dy));
    for (const id of hand) if (shift.has(id)) (X.set(id, Number(placed[id][0])), Y.set(id, Number(placed[id][1])));
    const lines = wires.map((w) => {
      const [da, db] = [shift.get(w.a), shift.get(w.b)], one = (points) => ({ ...w, points, stays: true });
      if (!da && !db) return one(w.points.map((p) => [...p]));
      // Two ends that moved as one carry their wire as it stands: a comb goes with its holder.
      if (da && db && da[0] === db[0] && da[1] === db[1]) return one(w.points.map(([p, q]) => [p + da[0], q + da[1]]));
      const out = da ? carry(w.points, da) : w.points;
      return { ...w, points: db ? [...carry([...out].reverse(), db)].reverse() : out };
    });
    // Wired round what stands, then again round what made room.
    let told;
    for (let round = 0; round < 2; round++) {
      reshape(X, Y, lines);
      const boxes = [...X.keys()].map((id) => { const n = nodes.get(id); return { id, at: [X.get(id), Y.get(id)], size: [n.w, n.h], named: [n.w, n.h] }; });
      told = settle({ boxes, lines, held: new Set(shift.keys()), ...lengths });
      // Only what made room moves: what is held, and what stayed, keep their numbers exactly.
      for (const b of boxes) if (!shift.has(b.id) && Math.hypot(b.at[0] - X.get(b.id), b.at[1] - Y.get(b.id)) > 0.5) (X.set(b.id, b.at[0]), Y.set(b.id, b.at[1]));
    }
    const made = { x: X, y: Y, moved: new Set(X.keys()), lines: new Map(lines.map((l) => [l.k, l.points.length > 1 ? l.points : [l.points[0], l.points[0]]])), told };
    last = { sign, made };
    return made;
  };
}
