// How a picture's wires cross, read off the wires as drawn. Three plain numbers, so none hides another: `crossings`, each
// place two wires of different links cross; `seen`, those places as the eye meets them, where wires that run together
// cross once; and `shared`, stretches where two wires lie along one another. Two wires of one item that meet at it, or
// that touch without passing, do not cross. Pure.

const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const within = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);

/** `wires` is a list of lines, each a list of [x, y]. */
export function count(wires) {
  const segs = [];
  wires.forEach((w, k) => {
    for (let i = 1; i < w.length; i++) if (w[i - 1][0] !== w[i][0] || w[i - 1][1] !== w[i][1]) segs.push({ k, a: w[i - 1], b: w[i], lo: Math.min(w[i - 1][0], w[i][0]), hi: Math.max(w[i - 1][0], w[i][0]), top: Math.min(w[i - 1][1], w[i][1]), low: Math.max(w[i - 1][1], w[i][1]) });
  });
  segs.sort((p, q) => p.lo - q.lo);
  let crossings = 0, shared = 0;
  const seen = new Set();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length && segs[j].lo <= s.hi; j++) {
      const t = segs[j];
      if (s.k === t.k || t.low < s.top || t.top > s.low) continue;
      const d1 = side(s.a, s.b, t.a), d2 = side(s.a, s.b, t.b);
      if (d1 === 0 && d2 === 0) {
        if (within(s.a, s.b, t.a) || within(s.a, s.b, t.b) || within(t.a, t.b, s.a)) shared++;
      } else if (d1 * d2 < 0 && side(t.a, t.b, s.a) * side(t.a, t.b, s.b) < 0) {
        crossings++;
        const u = d1 / (d1 - d2);
        seen.add(`${Math.round(t.a[0] + u * (t.b[0] - t.a[0]))},${Math.round(t.a[1] + u * (t.b[1] - t.a[1]))}`);
      }
    }
  }
  return { crossings, seen: seen.size, shared };
}
