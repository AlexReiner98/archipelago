// A big solved section far taller than the page, set as the columns of a newspaper: cut across where no box stands, each
// piece beside the last, so the whole comes out about the page's shape. A wire across a cut runs on along the foot of its
// column, up the gutter and over the head of the next, each on a track of its own, nested so that the wires keep their order
// and the wrap crosses nothing. Layer: metrics. Pure: places and lines in, changed in place.

/** A section of fewer items keeps to one column, however tall: its order reads straight down. */
const WRAP_FROM = 60;
/** How many times the count of columns is corrected by what it would make. */
const TRIES = 6;

/** Where the section can be cut: the gaps down it that no box stands in. */
function gapsOf(ids, y, nodes) {
  const spans = ids.map((id) => [y.get(id) - nodes.get(id).h / 2, y.get(id) + nodes.get(id).h / 2]).sort((p, q) => p[0] - q[0]), gaps = [];
  let foot = spans[0][1];
  for (const [top, end] of spans) {
    if (top > foot) gaps.push([foot, top]);
    foot = Math.max(foot, end);
  }
  return gaps;
}

/** A height in `gap` that no stretch across lies at. */
function clearOf(gap, level) {
  for (let k = 1; ; k++) {
    const at = gap[0] + ((gap[1] - gap[0]) * k) / (k + 1);
    if (!level.has(at)) return at;
  }
}

/** The section cut into `columns`, or as few as it has gaps for: where each column stands, and each wire's way over a cut. */
function plan({ ids, lines, x, y, nodes, gaps, level, top, height, track }, columns) {
  const nearest = (at) => gaps.reduce((best, g) => (Math.abs((g[0] + g[1]) / 2 - at) < Math.abs((best[0] + best[1]) / 2 - at) ? g : best));
  const cuts = [...new Set(Array.from({ length: columns - 1 }, (_, k) => nearest(top + (height * (k + 1)) / columns)))].map((g) => clearOf(g, level)).sort((p, q) => p - q);
  const columnOf = (at) => { let k = 0; while (k < cuts.length && at > cuts[k]) k++; return k; };
  const across = cuts.map(() => []), parts = cuts.concat(Infinity).map(() => ({ l: Infinity, r: -Infinity, t: Infinity, u: -Infinity }));
  const see = (k, px, py) => { const c = parts[k]; ((c.l = Math.min(c.l, px)), (c.r = Math.max(c.r, px)), (c.t = Math.min(c.t, py)), (c.u = Math.max(c.u, py))); };
  for (const id of ids) {
    const n = nodes.get(id), [px, py] = [x.get(id), y.get(id)], k = columnOf(py);
    (see(k, px - n.w / 2, py - n.h / 2), see(k, px + n.w / 2, py + n.h / 2));
  }
  lines.forEach((l, at) => l.points.forEach((p, i) => {
    const k = columnOf(p[1]), q = l.points[i + 1];
    see(k, p[0], p[1]);
    if (!q) return;
    const m = columnOf(q[1]);
    for (let c = Math.min(k, m); c < Math.max(k, m); c++) {
      across[c].push({ at, i, px: p[0] });
      (see(c, p[0], cuts[c]), see(c + 1, p[0], cuts[c]));
    }
  }));
  for (const list of across) list.sort((p, q) => p.px - q.px).forEach((w, k) => (w.rank = k));
  // Every column stands under the tracks of the widest head, each with its gutter after it.
  const head = (Math.max(0, ...across.map((a) => a.length)) + 1) * track, starts = [];
  let w = 0;
  parts.forEach((c, k) => { starts.push(w); w += c.r - c.l + (k < across.length ? (across[k].length + 2) * track : 0); });
  const h = head + Math.max(...parts.map((c, k) => c.u - c.t + ((across[k]?.length ?? 0) + 1) * track));
  return { cuts, columnOf, across, parts, head, starts, w, h };
}

/** The lines and places of `ids` moved into the columns of `p`. */
function apply({ ids, lines, x, y }, { columnOf, across, parts, head, starts }, track) {
  const moved = (k, [px, py]) => [px - parts[k].l + starts[k], py - parts[k].t + head];
  /** A wire's way from column `c` to the next. */
  const turn = (c, { px, rank }) => {
    const count = across[c].length, foot = parts[c].u - parts[c].t + head + (count - rank) * track, gutter = starts[c] + parts[c].r - parts[c].l + (count - rank) * track, over = head - (rank + 1) * track;
    return [[px - parts[c].l + starts[c], foot], [gutter, foot], [gutter, over], [px - parts[c + 1].l + starts[c + 1], over]];
  };
  const crossing = new Map(across.flatMap((list, c) => list.map((w) => [`${w.at} ${w.i} ${c}`, w])));
  lines.forEach((line, at) => {
    const out = [];
    line.points.forEach((p, i) => {
      const k = columnOf(p[1]), q = line.points[i + 1];
      out.push(moved(k, p));
      if (!q) return;
      const m = columnOf(q[1]);
      for (let c = k; c < m; c++) out.push(...turn(c, crossing.get(`${at} ${i} ${c}`)));
      for (let c = k - 1; c >= m; c--) out.push(...turn(c, crossing.get(`${at} ${i} ${c}`)).reverse());
    });
    line.points = out;
  });
  for (const id of ids) {
    const [px, py] = moved(columnOf(y.get(id)), [x.get(id), y.get(id)]);
    (x.set(id, px), y.set(id, py));
  }
}

/** The section of `ids` and its `lines`, with `extent` its size, in as many columns as bring it to `aspect`. */
export function wrap({ ids, lines, x, y, nodes, extent, aspect, track }) {
  if (ids.length < WRAP_FROM) return;
  const { t: top, w: wide, h: height } = extent, gaps = gapsOf(ids, y, nodes);
  let columns = Math.round(Math.sqrt((aspect * height) / wide));
  if (columns < 2 || !gaps.length) return;
  const level = new Set(lines.flatMap((l) => l.points.slice(1).flatMap((p, i) => (p[1] === l.points[i][1] ? [p[1]] : [])))), section = { ids, lines, x, y, nodes, gaps, level, top, height, track };
  let best = null, off = Math.abs(Math.log(wide / height / aspect));
  for (let k = 0; k < TRIES; k++) {
    const made = plan(section, columns), miss = Math.abs(Math.log(made.w / made.h / aspect));
    if (miss < off) ((best = made), (off = miss));
    const next = Math.max(2, Math.round(columns * Math.sqrt(aspect / (made.w / made.h))));
    if (next === columns) break;
    columns = next;
  }
  if (best) apply(section, best, track);
}
