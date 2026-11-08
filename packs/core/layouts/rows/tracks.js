// Layer: metrics. Tracks by the left-edge method, as a channel router lays them: runs taken from the left, each put on
// the first track whose last run ends before it starts, so wires that do not overlap share a track; and a run whose end
// turns off across another run's span goes on the side that end turns to, so the two do not cross (the vertical
// constraints of channel routing). Used for the runs in a street between rows and in a gutter beside a column. Pure.

/**
 * Each run's track, from 0, the nearest. A run is { key, lo, hi, ends? }: runs with one key are one (their union), as
 * the wires into one item merge; `ends` are where it turns off, { at, near }, `near` when it turns toward track 0.
 * Two runs on one track keep `apart` between them. Where the constraints loop, the leftmost run waiting goes first.
 * Answers { track: Map key -> index, count }.
 */
export function packed(intervals, apart = 0) {
  const runs = new Map();
  for (const { key, lo, hi, ends = [] } of intervals) {
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo], run = runs.get(key);
    runs.set(key, run ? { key, lo: Math.min(run.lo, a), hi: Math.max(run.hi, b), ends: [...run.ends, ...ends] } : { key, lo: a, hi: b, ends: [...ends] });
  }
  const list = [...runs.values()].sort((p, q) => p.lo - q.lo || p.hi - q.hi || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  // Which runs must be nearer than which: an end of q inside p's span turns toward 0 (q nearer) or away (p nearer).
  const before = new Map(list.map((r) => [r.key, new Set()]));
  for (const p of list) for (const q of list) {
    if (p === q) continue;
    for (const e of q.ends) if (e.at > p.lo && e.at < p.hi) (e.near ? before.get(p.key).add(q.key) : before.get(q.key).add(p.key));
  }
  const track = new Map();
  let count = 0;
  while (track.size < list.length) {
    let end = -Infinity, put = 0;
    const ready = (r) => [...before.get(r.key)].every((k) => track.has(k) && track.get(k) < count);
    for (const r of list) if (!track.has(r.key) && r.lo > end + apart && ready(r)) (track.set(r.key, count), (end = r.hi), put++);
    // A loop of constraints: the leftmost run still waiting takes the track, and what fits after it.
    if (!put) for (const r of list) if (!track.has(r.key) && r.lo > end + apart) (track.set(r.key, count), (end = r.hi));
    count++;
  }
  return { track, count };
}
