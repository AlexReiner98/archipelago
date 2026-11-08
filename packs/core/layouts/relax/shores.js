// An island's shore as the relaxation keeps it (step 3, task e_7et8f4uv): not its border's rectangle but bands down it,
// each as wide as what stands in it needs, so a quiet row of an island is no wider than its own. The shape (step 2)
// keeps the border a rectangle, and nothing stands inside it but the island's own; the bands are read off that inside.
// Each band's left and right side is a number of the x axis, each line between two bands one of the y axis; a step from
// one band to the next is a stretch of shore facing the sea, up or down. A port stands on the band it meets.
// Layer: metrics. Pure: the read shape in, its shores out.

import { isBox, TOUCH } from './atoms.js';

/** How far a band stands off what it holds, in grid units: past the sweep's touch, so a step never sees what it steps round. */
const OFF = 1;

/** How far a stretch of shore is drawn in at each end for the sweep, past its touch: what stands in the next band, its
 *  edge on the line between the two, is not beside it. */
const IN = TOUCH + 0.25;

/** Whether a point stands on a rectangle's border line, on axis a's low or high side. */
const onSide = (p, rect) => p[0] === rect[0] || p[0] === rect[2] || p[1] === rect[1] || p[1] === rect[3];

/** What stands inside an island's rectangle, each as [l, t, r, b] already stood off by `OFF` (a port on its side: not). */
function insideOf(read, i, ports) {
  const [x0, y0, x1, y1] = i.rect, out = [], inRect = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const off = ([l, t, r, b]) => [Math.max(x0, l - OFF), Math.max(y0, t - OFF), Math.min(x1, r + OFF), Math.min(y1, b + OFF)];
  for (const n of read.nodes.values()) {
    if (n.kind === 'port' || !inRect([n.x, n.y]) || onSide([n.x, n.y], i.rect)) continue;
    out.push(off(isBox(n) ? [n.x - n.w / 2, n.y - n.h / 2, n.x + n.w / 2, n.y + n.h / 2] : [n.x, n.y, n.x, n.y]));
  }
  for (const w of read.wires) w.points.forEach((q, k) => {
    const o = w.points[k - 1];
    if (!k || !inRect(o) || !inRect(q) || (onSide(o, i.rect) && onSide(q, i.rect) && (o[0] === q[0] ? o[0] === x0 || o[0] === x1 : o[1] === y0 || o[1] === y1))) return;
    out.push(off([Math.min(o[0], q[0]), Math.min(o[1], q[1]), Math.max(o[0], q[0]), Math.max(o[1], q[1])]));
  });
  // A port stands on its side exactly, and reaches in from it as far as the rest stand off.
  for (const p of ports) {
    const [x, y] = [p.node.x, p.node.y], [l, t, r, b] = off([x, y, x, y]);
    out.push({ left: [x, t, r, b], right: [l, t, x, b], top: [l, y, r, b], bottom: [l, t, r, y] }[p.side]);
  }
  return out;
}

/** The bands down an island: [t, b, l, r] each, as wide as what overlaps it, any thinner or nearer its neighbour than `step` joined to it. */
function bandsOf(inside, step) {
  const ys = [...new Set(inside.flatMap(([, t, , b]) => [t, b]))].sort((p, q) => p - q), out = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const [t, b] = [ys[k], ys[k + 1]], here = inside.filter((c) => c[1] < b && c[3] > t);
    const [l, r] = here.length ? [Math.min(...here.map((c) => c[0])), Math.max(...here.map((c) => c[2]))] : out.length ? [out.at(-1)[2], out.at(-1)[3]] : [Infinity, -Infinity];
    out.push([t, b, l, r]);
  }
  // A band with nothing in it before any that has takes the first that has.
  const first = out.find((x) => x[2] <= x[3]);
  for (const x of out) if (x[2] > x[3]) [x[2], x[3]] = [first[2], first[3]];
  // Bands alike to `step` are one; then a band thinner than `step` joins the neighbour nearest its width.
  const join = (k) => { const [a, c] = [out[k], out[k + 1]]; out.splice(k, 2, [a[0], c[1], Math.min(a[2], c[2]), Math.max(a[3], c[3])]); };
  const apart = (a, c) => Math.max(Math.abs(a[2] - c[2]), Math.abs(a[3] - c[3]));
  for (let k = 0; k + 1 < out.length; ) if (apart(out[k], out[k + 1]) <= step) join(k); else k++;
  for (let k; (k = out.findIndex((x) => x[1] - x[0] < step)) >= 0 && out.length > 1; ) {
    const up = k > 0 ? apart(out[k - 1], out[k]) : Infinity, down = k + 1 < out.length ? apart(out[k], out[k + 1]) : Infinity;
    join(up <= down ? k - 1 : k);
    for (let j = Math.max(0, k - 2); j + 1 < out.length && j <= k; ) if (apart(out[j], out[j + 1]) <= step) join(j); else j++;
  }
  return out;
}

/**
 * The shores of every island of `read` (./atoms.js), with `step` the least step of a shore in grid units. Joins each
 * port on a side to the band it meets, on `read.axes`. Answers `islands` (each with its `bands` and the keys of their
 * sides: `x[k]` = [left, right] of band k, `y[j]` the line over band j, the last under the last band), `things[a]` (each
 * stretch of shore on axis a: { low, high, kind: 'lo' facing the island past it, 'hi' facing it before it, island, at,
 * lo, hi, top }), `start` (each key's grid place, by axis), and `ports` (a port on a side, its band and side keys).
 */
export function shoresOf(read, step) {
  const islands = [], things = [[], []], start = [new Map(), new Map()], ports = [];
  for (const i of read.islands.values()) {
    const own = read.ports.filter((p) => p.island === i.id && p.on);
    const inside = insideOf(read, i, own);
    if (!inside.length) inside.push([...i.rect.slice(0, 2), ...i.rect.slice(2)]);
    const bands = bandsOf(inside, step);
    const x = bands.map((_, k) => [`s:${i.id}:x${k}:0`, `s:${i.id}:x${k}:1`]), y = [...bands.map((_, j) => `s:${i.id}:y${j}`), `s:${i.id}:y${bands.length}`];
    // The border's rectangle, undrawn: held where the grid put it, every band inside it, so the island is pressed
    // together as a rectangle would press it while what is outside meets only its bands.
    const frame = [`s:${i.id}:frame:0`, `s:${i.id}:frame:1`];
    for (const ax of read.axes) for (const key of [...x.flat(), ...y, ...frame]) ax.add(key);
    for (const a of [0, 1]) (start[a].set(frame[0], i.rect[a]), start[a].set(frame[1], i.rect[a + 2]));
    bands.forEach(([t, b, l, r], k) => {
      (start[0].set(x[k][0], l), start[0].set(x[k][1], r), start[1].set(y[k], t));
      things[0].push({ low: x[k][0], high: x[k][0], kind: 'lo', island: i, at: l, lo: t + IN, hi: b - IN }, { low: x[k][1], high: x[k][1], kind: 'hi', island: i, at: r, lo: t + IN, hi: b - IN });
    });
    start[1].set(y[bands.length], bands.at(-1)[1]);
    // Over the first band, under the last, and between two the steps where one is wider than the other.
    const piece = (j, lo, hi, kind, top) => hi - lo > 0 && things[1].push({ low: y[j], high: y[j], kind, island: i, at: j < bands.length ? bands[j][0] : bands.at(-1)[1], lo: lo + IN, hi: hi - IN, top: !!top });
    piece(0, bands[0][2], bands[0][3], 'lo', true);
    piece(bands.length, bands.at(-1)[2], bands.at(-1)[3], 'hi');
    for (let j = 1; j < bands.length; j++) {
      const [up, down] = [bands[j - 1], bands[j]];
      piece(j, Math.min(up[2], down[2]), Math.max(up[2], down[2]), down[2] < up[2] ? 'lo' : 'hi');
      piece(j, Math.min(up[3], down[3]), Math.max(up[3], down[3]), down[3] > up[3] ? 'lo' : 'hi');
    }
    // A port stands on the band it meets: a side port on that band's side, a top or bottom one on the first or last line.
    for (const p of own) {
      const [px, py] = [p.node.x, p.node.y];
      if (p.side === 'left' || p.side === 'right') {
        const hi = p.side === 'right' ? 1 : 0, meets = bands.map((_, k) => k).filter((k) => py >= bands[k][0] - TOUCH && py <= bands[k][1] + TOUCH);
        const k = meets.find((k) => bands[k][2 + hi] === px) ?? meets[0] ?? 0, side = x[k][hi];
        if (!read.axes[0].join(side, `n:${p.id}`)) read.axes[0].refused++;
        ports.push({ id: p.id, axis: 1, lo: y[k], hi: y[k + 1] });
      } else {
        const j = p.side === 'top' ? 0 : bands.length, k = p.side === 'top' ? 0 : bands.length - 1;
        if (!read.axes[1].join(y[j], `n:${p.id}`)) read.axes[1].refused++;
        ports.push({ id: p.id, axis: 0, lo: x[k][0], hi: x[k][1] });
      }
    }
    islands.push({ id: i.id, bands, x, y, frame });
  }
  return { islands, things, start, ports };
}
