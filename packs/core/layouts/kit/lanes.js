// Spans packed into lanes (the kit, task e_7v52ek3c): a gutter's lanes beside a strip, the sea's between islands, the
// tracks between rows. The left-edge method: spans by where they start, each into the first lane it fits after the last
// span there, which takes as few lanes as the most spans that overlap at one point. The lanes are then set out with the
// shortest nearest the boxes, so a short link nests inside a long one and crosses none of it. Layer: metrics. Pure.

/**
 * Each span's lane, from 0 nearest the boxes. `spans` are [lo, hi]; two share a lane when the later starts at least
 * `apart` past the end of the earlier (1 for rows counted whole: a span may not start on the row another ends on).
 */
export function lanes(spans, apart = 1) {
  const order = spans.map((s, k) => k).sort((p, q) => spans[p][0] - spans[q][0] || spans[p][1] - spans[q][1]);
  const ends = [], members = [], laneOf = new Array(spans.length);
  for (const k of order) {
    const [lo, hi] = spans[k];
    let at = ends.findIndex((end) => lo - end >= apart);
    if (at < 0) (at = ends.length, ends.push(hi), members.push([]));
    ends[at] = hi;
    members[at].push(k);
    laneOf[k] = at;
  }
  // The shortest lanes nearest: by the longest span each holds, then by where it starts.
  const reach = (m) => Math.max(...m.map((k) => spans[k][1] - spans[k][0]));
  const set = members.map((m, at) => at).sort((p, q) => reach(members[p]) - reach(members[q]) || spans[members[p][0]][0] - spans[members[q][0]][0]);
  const renamed = new Map(set.map((at, k) => [at, k]));
  return { lane: laneOf.map((at) => renamed.get(at)), count: members.length };
}
