// Where each stop stands and the order of the wires round it, in cells and slots, not yet in lengths. Layer: topology.
//
// The stops are read along rows of `columns` cells, the first row left to right, the next right to left, and so on,
// so the rail between two stops is always straight: across a row, or down where a row ends into the one below. Every
// other wire leaves the stop read first by its foot and reaches the later one through the gutters between rows (a
// lane each) and, past the next row, down a gap between columns (a track each): never across a stop. Each wire end
// takes a slot of its own on its box's side, the middle one kept for the rail, and the slots under a column in one
// gutter are one pool for the box above and the box below, so no two ends there ever stand on one line.

/** The cell of the stop read k-th: its row, and its column, right to left on odd rows. */
export function cellOf(k, columns) {
  const row = Math.floor(k / columns), at = k % columns;
  return { row, column: row % 2 ? columns - 1 - at : at };
}

/** How a wire runs: within its row's gutter, into the next row, or on past it down a gap between columns. */
const kindOf = (e, l) => (e.row === l.row ? 'row' : l.row === e.row + 1 ? 'next' : 'far');

/**
 * The gap between columns a far wire goes down: one between its two ends' columns (beside the column, when both are
 * in one), the one with the fewest wires so far.
 */
function gapFor(e, l, used, columns) {
  const lo = Math.min(e.column, l.column), hi = Math.max(e.column, l.column);
  const choices = lo === hi ? [lo, lo + 1] : Array.from({ length: hi - lo }, (_, k) => lo + 1 + k);
  return choices.reduce((best, j) => ((used[j] ?? 0) < (used[best] ?? 0) || ((used[j] ?? 0) === (used[best] ?? 0) && Math.abs(j - columns / 2) < Math.abs(best - columns / 2)) ? j : best), choices[0]);
}

/**
 * The stops' cells, each wire's kind, slots, gap and track, how many slots each column needs on a side, and how many
 * tracks each gap holds. `count` stops, `columns` across, `wires` as roles() gives them.
 */
export function grid(count, columns, wires) {
  const across = Math.max(1, Math.min(columns, count)), cells = Array.from({ length: count }, (_, k) => cellOf(k, across));
  const rows = count ? cells[count - 1].row + 1 : 0, used = [], laid = [];
  for (const w of wires) {
    const e = cells[w.early], l = cells[w.late], kind = kindOf(e, l);
    const gap = kind === 'far' ? gapFor(e, l, used, across) : undefined;
    if (gap !== undefined) used[gap] = (used[gap] ?? 0) + 1;
    laid.push({ ...w, kind, e, l, gap });
  }
  // The ends in each pool (a gutter under a column), each with where its wire heads: a column, or a gap's place.
  const pools = new Map(), join = (key, end) => (pools.get(key) ?? pools.set(key, []).get(key)).push(end);
  for (const w of laid) {
    const toward = (here, there) => (w.kind === 'far' ? w.gap - 0.5 : there.column);
    join(`${w.e.row}:${w.e.column}`, { w, end: 'early', toward: toward(w.e, w.l), column: w.e.column });
    join(`${w.kind === 'far' ? w.l.row - 1 : w.e.row}:${w.l.column}`, { w, end: 'late', toward: toward(w.l, w.e), column: w.l.column });
  }
  // Slots: those heading left on the left, the farthest outermost; those going straight down to the side with fewer.
  const slots = new Map(), need = Array(across).fill(0);
  for (const ends of pools.values()) {
    const c = ends[0].column, left = ends.filter((x) => x.toward < c), right = ends.filter((x) => x.toward > c);
    for (const x of ends.filter((x) => x.toward === c)) (left.length <= right.length ? left : right).push(x);
    left.sort((p, q) => q.toward - p.toward).forEach((x, k) => slots.set(x, -(k + 1)));
    right.sort((p, q) => p.toward - q.toward).forEach((x, k) => slots.set(x, k + 1));
    need[c] = Math.max(need[c], left.length, right.length);
  }
  for (const ends of pools.values()) for (const x of ends) x.w[x.end === 'early' ? 'eSlot' : 'lSlot'] = slots.get(x);
  // Tracks down each gap: two far wires share one only when the gutters they span do not meet.
  const tracks = Array(across + 1).fill(0), ends = Array.from({ length: across + 1 }, () => []);
  for (const w of laid.filter((x) => x.kind === 'far').sort((p, q) => p.e.row - q.e.row || p.l.row - q.l.row)) {
    const span = [w.e.row, w.l.row - 1], free = ends[w.gap].findIndex((last) => last < span[0]);
    w.track = free >= 0 ? free : ends[w.gap].length;
    ends[w.gap][w.track] = span[1];
    tracks[w.gap] = ends[w.gap].length;
  }
  return { cells, rows, columns: across, wires: laid, need, tracks };
}
