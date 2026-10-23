// What a wire carries is written on it where there is room: on its run into what it calls, else on its run from the
// caller, else on a run between; otherwise only in its tooltip. A spot has room when no other wire runs through
// the words, they keep clear of both ends of every wire (its arrowhead and its base, its own wire's too), and no
// part, place's name or other wire's words are there.

/** The parts of a layout, as [left, top, right, bottom]. */
export const partBoxes = (g) => g.all.filter((n) => !n.dummy).map((n) => [g.x.get(n.id) - n.w / 2, g.y.get(n.id) - n.h / 2, g.x.get(n.id) + n.w / 2, g.y.get(n.id) + n.h / 2]);

/** Where each of `labels` ({ c: a wire, text }) is written, as { c, text, x, y, w }; those with no room are left out. */
export function saysSpots({ labels, chains, boxes, parts = [], measure, z }) {
  const [SAYS_TEXT, PLACE_TEXT, HIGH] = [z('says_text'), z('place_text'), z('says_height')];
  // An arrowhead's half width and its length, as story.js and index.js draw it.
  const [HEAD_HALF, HEAD_LONG] = [4.5, 9];
  // Every part, as [left, top, right, bottom]: words never cover one.
  const onPart = (x, y, w) => parts.some(([l, t, r, b]) => x + w / 2 > l - 2 && x - w / 2 < r + 2 && y + HIGH / 2 > t - 2 && y - HIGH / 2 < b + 2);
  const placed = boxes.map((b) => [b.x + Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room')) / 2, b.y + z('place_name_inset') + z('place_name_height') / 2, Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room'))]);
  // Whether another wire passes through a box of words centred at x, y.
  const crossed = (c, x, y, w) =>
    chains.some((o) => o !== c && o.points.some((p, k) => k > 0 && Math.max(p[0], o.points[k - 1][0]) >= x - w / 2 && Math.min(p[0], o.points[k - 1][0]) <= x + w / 2 && Math.max(p[1], o.points[k - 1][1]) >= y - HIGH / 2 && Math.min(p[1], o.points[k - 1][1]) <= y + HIGH / 2));
  // Both ends of every wire, its own too: where it leaves a part and where its arrowhead goes into one.
  const ends = chains.flatMap((o) => [o.points[0], o.points.at(-1)]);
  const onEnd = (x, y, w) => ends.some(([ex, ey]) => Math.abs(ex - x) <= w / 2 + HEAD_HALF && Math.abs(ey - y) <= HIGH / 2 + HEAD_LONG);
  return labels.flatMap(({ c, text }) => {
    const w = measure(text, SAYS_TEXT) + 2 * z('says_pad'), p = c.points;
    // The middle of each run long enough to hold the words: the run in first, then the run out, then the rest.
    const runs = p.slice(1).map((q, k) => [p[k], q]);
    const spots = [runs.at(-1), runs[0], ...runs.slice(1, -1)]
      .filter(([[x1, y1], [x2, y2]]) => (Math.abs(y1 - y2) < 0.01 ? Math.abs(x2 - x1) > w + 16 : Math.abs(y2 - y1) > HIGH))
      .map(([[x1, y1], [x2, y2]]) => [(x1 + x2) / 2, (y1 + y2) / 2]);
    const spot = spots.find(([lx, ly]) => !crossed(c, lx, ly, w) && !onEnd(lx, ly, w) && !onPart(lx, ly, w) && !placed.some(([px, py, pw]) => Math.abs(px - lx) < (pw + w) / 2 + 4 && Math.abs(py - ly) < HIGH));
    if (!spot) return [];
    placed.push([...spot, w]);
    return [{ c, text, x: spot[0], y: spot[1], w }];
  });
}
