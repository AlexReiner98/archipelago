// Layer: metrics. Where each entry of a row stands across: blocks in the order they were made, then the waypoints of
// the wires that cross the row, packed from the left; then a fixed number of straightening passes, as iongraph's,
// each moving an entry only rightward, pushing the rest of its row along but no wider than the widest row was packed:
// down the rows, each toward what it hangs from; up the rows, each toward what hangs from it. A fixed count, never
// until nothing moves. Pure.

const median = (list) => {
  const s = [...list].sort((p, q) => p - q), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Each entry's x. `rows` is a list of rows, each a list of entries { id, w, way? } in order; `ties` are { up, upDx,
 * down, downDx }: the point upDx along entry `up` wants to stand over the point downDx along entry `down`, in a lower
 * row. `stage` is told each pass. Answers a map of id to x.
 */
export function placed(rows, ties, z, stage) {
  const x = new Map(), apart = (p, q) => (p.way && q.way ? z.lane : z.gap);
  for (const row of rows) {
    let at = 0;
    row.forEach((e, k) => (x.set(e.id, at), (at += e.w + (k + 1 < row.length ? apart(e, row[k + 1]) : 0))));
  }
  // How far right a block may go: the widest row as packed, less the blocks after it. Waypoints go where they must.
  const wide = Math.max(0, ...rows.flatMap((row) => row.filter((e) => !e.way).map((e) => x.get(e.id) + e.w))), most = new Map();
  for (const row of rows) {
    let tail = wide;
    for (const e of [...row].reverse().filter((v) => !v.way)) (most.set(e.id, tail - e.w), (tail -= e.w + z.gap));
  }
  const over = new Map(), under = new Map();
  for (const t of ties) ((over.get(t.down) ?? over.set(t.down, []).get(t.down)).push(t), (under.get(t.up) ?? under.set(t.up, []).get(t.up)).push(t));
  /** Each entry of a row, from the left, moved right toward where it wants to be, pushing those after it along. */
  const sweep = (row, want) => {
    row.forEach((e, k) => {
      const wish = want(e), prev = row[k - 1], least = prev ? x.get(prev.id) + prev.w + apart(prev, e) : -Infinity;
      const to = Math.min(wish ?? -Infinity, most.get(e.id) ?? Infinity);
      x.set(e.id, Math.max(x.get(e.id), least, to));
    });
  };
  const fromAbove = (e) => (over.has(e.id) ? median(over.get(e.id).map((t) => x.get(t.up) + t.upDx - t.downDx)) : undefined);
  const fromBelow = (e) => (under.has(e.id) ? median(under.get(e.id).map((t) => x.get(t.down) + t.downDx - t.upDx)) : undefined);
  for (let pass = 0; pass < z.straighten; pass++) {
    for (const row of rows) sweep(row, fromAbove);
    for (const row of [...rows].reverse()) sweep(row, fromBelow);
    stage?.(`straighten ${pass + 1}`, { x: Object.fromEntries(x) });
  }
  return x;
}
