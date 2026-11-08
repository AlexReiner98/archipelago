// Where a strip far taller than the page is cut into columns (task e_3svu8hbh), as a newspaper is: into as many as
// bring the strip to the page's shape, each cut between two rows near where it should fall, at the row the fewest lanes
// cross, so few links run from one column to the next. Layer: shape. Pure: rows and spans in, the columns out.

/**
 * The columns of `order` (ids, top first): `heights` each row's height with the gap after it, `spans` each link's
 * [first row, last row], `width` and `aspect` the strip's width and the shape it is cut toward. A strip of fewer than
 * `from` rows is one column. Each column is a list of ids.
 */
export function columns({ order, heights, spans, width, aspect, from }) {
  const n = order.length, total = heights.reduce((s, h) => s + h, 0);
  const count = Math.min(Math.floor(n / 2), Math.round(Math.sqrt((aspect * total) / Math.max(1, width))));
  if (n < from || count < 2) return [order];
  // How far down each cut between rows b - 1 and b falls, and how many spans cross it.
  const down = [0];
  for (const h of heights) down.push(down.at(-1) + h);
  const crossing = (b) => spans.filter(([lo, hi]) => lo < b && hi >= b).length;
  const cuts = [];
  for (let k = 1; k < count; k++) {
    const target = (k * total) / count, reach = total / (4 * count), after = cuts.at(-1) ?? 0;
    const near = Array.from({ length: n - 1 }, (_, b) => b + 1).filter((b) => b > after && Math.abs(down[b] - target) <= reach);
    if (!near.length) continue;
    cuts.push(near.reduce((best, b) => (crossing(b) < crossing(best) || (crossing(b) === crossing(best) && Math.abs(down[b] - target) < Math.abs(down[best] - target)) ? b : best)));
  }
  return [0, ...cuts].map((at, k) => order.slice(at, cuts[k] ?? n));
}
