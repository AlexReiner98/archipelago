// Wire placement made good in one try (task e_wayfga4d): what one threading leaves is mended where it stands, not drawn
// again with a little noise and the best of eight kept. A wire threaded early takes the way that is shortest then, and
// those threaded after it pay for that; which wires come first decides more than anything (crossings from 12 to 34 on
// one line), and threading each crossing wire again soon stops gaining. So the mending is a guided local search: each
// wire that crosses is threaded again, the shortest way the others leave; where that stops gaining, the wires crossed
// most are made dearer to cross, so the next pass moves their crossings elsewhere; the fewest crossings seen are kept.
// Counted and the same each time. Layer: topology. Pure: a threader over a threaded graph in, changed in place.

/**
 * Mends what `t` (../flow/thread.js's threader) has threaded: `live()` lists the wires that may be threaded again (each
 * with its `link`), `dear` is the map the threader's cost reads, by link, of how much dearer crossing a wire is,
 * `rounds` the most times wires are made dearer, `step` by how much each time (one more for each the cost it was), and `work` the most work the mending may count, as the threader counts
 * it. Answers how many passes it made.
 */
export function repair(t, { live, dear, rounds, step, work }) {
  const until = t.tally.work + work, crosses = (w) => t.crossed(w).filter((x) => x.link?.wire);
  let best = t.tally.crossings, kept = null, passes = 0;
  /** Each wire that crosses threaded again, the most crossed first: never worse for it, at the cost it is priced at. */
  const pass = () => {
    passes++;
    const wires = live().map((w) => [w, crosses(w).length]).filter(([, n]) => n).sort((p, q) => q[1] - p[1]);
    for (const [w] of wires) {
      if (t.tally.work > until) return false;
      if (!t.free(w) || !t.apart(w)) continue;
      t.take(w);
      t.through([w.link]);
    }
    return true;
  };
  const note = () => {
    if (t.tally.crossings < best) ((best = t.tally.crossings), (kept = t.save()));
  };
  const finish = () => {
    dear.clear();
    if (kept && t.tally.crossings > best) t.back(kept);
    return passes;
  };
  for (let round = 0; round <= rounds; round++) {
    // Passes until one gains nothing at the present prices.
    for (let was = Infinity; t.tally.crossings < was; ) {
      was = t.tally.crossings;
      if (!pass()) return finish();
      note();
    }
    // Then the wires crossed most, for what they already cost, made dearer.
    const by = live().map((w) => [w.link, crosses(w).length / (1 + (dear.get(w.link) ?? 0))]).filter(([, u]) => u);
    if (!by.length) break;
    const most = Math.max(...by.map(([, u]) => u));
    for (const [l, u] of by) if (u === most) dear.set(l, (dear.get(l) ?? 0) + step);
  }
  return finish();
}
