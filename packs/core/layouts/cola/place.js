// Where each item rests in a cola picture (task e_x7kwbu3e): WebCola's constrained stress, run once to rest from a fixed
// start (./start.js) for counts the style sets, never left running, so one model always rests the same. Every link pulls
// its two ends to a length; each kept order link (./order.js) holds what is depended on above what depends on it; each
// island kept together and apart from the rest; no two boxes overlap, each its size in the model. Pure but for WebCola,
// which is handed in (`cola`, the vendored ui/cola.module.min.js): the model in, boxes and island frames out.

/** A rectangle round boxes, `pad` out from them. */
export const around = (boxes, pad) => {
  const l = Math.min(...boxes.map((b) => b.x - b.w / 2)) - pad, t = Math.min(...boxes.map((b) => b.y - b.h / 2)) - pad;
  const r = Math.max(...boxes.map((b) => b.x + b.w / 2)) + pad, b = Math.max(...boxes.map((b) => b.y + b.h / 2)) + pad;
  return { l, t, r, b };
};

/**
 * The places: `boxes`, each { id, x, y, w, h } by its centre; `islands`, each { id, l, t, r, b }; and the picture's
 * `width` and `height`, all moved so the picture starts `margin` from the top left. `z` is the style's lengths and counts.
 */
export function placeOf(model, order, start, z, cola) {
  const { items } = model, index = new Map(items.map((it, n) => [it.id, n]));
  // A box's room is its size and a gap round it: cola keeps rooms from overlapping.
  const nodes = items.map((it) => ({ x: start.get(it.id).x, y: start.get(it.id).y, width: it.w + z.gap, height: it.h + z.gap }));
  // Every link pulls its ends to a length; one between islands to a longer one, so each island keeps together.
  const seen = new Set(), links = [];
  for (const l of model.links) {
    if (!index.has(l.from) || !index.has(l.to) || l.from === l.to) continue;
    const a = index.get(l.from), b = index.get(l.to), key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (!seen.has(key)) (seen.add(key), links.push({ source: a, target: b, length: items[a].island === items[b].island ? z.link : z.link * z.across }));
  }
  const constraints = order.kept.map((k) => {
    const above = items[index.get(k.above)], under = items[index.get(k.below)];
    return { axis: 'y', left: index.get(k.above), right: index.get(k.below), gap: (above.h + under.h) / 2 + z.rise };
  });
  // No WebCola groups: with them its overlap removal stacks every island into one tall column. The islands are kept
  // apart below instead, their frames parted as boxes are.
  const layout = new cola.Layout()
    .nodes(nodes).links(links).constraints(constraints)
    .avoidOverlaps(true).handleDisconnected(false).distanceMatrix(distancesOf(items.length, links, z.link * z.across)).convergenceThreshold(z.settled);
  // Run once, to rest: free, then with the order, then with everything; no grid snap, no keeping on, no centring.
  layout.start(z.free, z.held, z.all, 0, false, false);
  const boxes = items.map((it, n) => ({ id: it.id, x: nodes[n].x, y: nodes[n].y, w: it.w, h: it.h }));
  const frames = apart(model, boxes, z, cola);
  const whole = around([...boxes, ...frames.map((f) => ({ x: (f.l + f.r) / 2, y: (f.t + f.b) / 2, w: f.r - f.l, h: f.b - f.t }))], 0);
  const dx = z.margin - whole.l, dy = z.margin - whole.t;
  for (const b of boxes) (b.x += dx, b.y += dy);
  for (const f of frames) (f.l += dx, f.r += dx, f.t += dy, f.b += dy);
  return { boxes, islands: frames, width: whole.r - whole.l + 2 * z.margin, height: whole.b - whole.t + 2 * z.margin };
}

/**
 * How far apart each two boxes should rest: the shortest way between them along the links, each its length; two that
 * no way joins, `apart`. Given whole, so stress pulls every pair (WebCola's own leaves pairs no way joins to push each
 * other off without end, and a picture of many small parts spreads out in a line).
 */
export function distancesOf(n, links, apart) {
  const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const next = Array.from({ length: n }, () => []);
  for (const l of links) (next[l.source].push([l.target, l.length]), next[l.target].push([l.source, l.length]));
  for (let s = 0; s < n; s++) {
    const d = D[s], done = new Uint8Array(n);
    for (;;) {
      let v = -1;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (v < 0 || d[i] < d[v])) v = i;
      if (v < 0) break;
      done[v] = 1;
      for (const [w, len] of next[v]) if (d[v] + len < d[w]) d[w] = d[v] + len;
    }
  }
  return D.map((row) => row.map((v) => (v === Infinity ? apart : v)));
}

/**
 * The island frames, parted: each island's frame (and each box on none, as one of its own), `sea` apart, moved the
 * least that leaves none overlapping (WebCola's removeOverlaps), and its boxes moved with it. Answers the frames.
 */
export function apart(model, boxes, z, cola) {
  const on = new Map((model.islands ?? []).map((i) => [i.id, []]));
  const lone = [];
  boxes.forEach((b, n) => (on.has(model.items[n].island) ? on.get(model.items[n].island).push(b) : lone.push([b])));
  const parts = [...[...on].filter(([, bs]) => bs.length).map(([id, bs]) => ({ id, boxes: bs, frame: around(bs, z.pad) })), ...lone.map((bs) => ({ id: null, boxes: bs, frame: around(bs, 0) }))];
  const half = z.sea / 2, rects = parts.map((p) => new cola.Rectangle(p.frame.l - half, p.frame.r + half, p.frame.t - half, p.frame.b + half));
  const was = rects.map((r) => [r.cx(), r.cy()]);
  cola.removeOverlaps(rects);
  parts.forEach((p, n) => {
    const dx = rects[n].cx() - was[n][0], dy = rects[n].cy() - was[n][1];
    for (const b of p.boxes) (b.x += dx, b.y += dy);
    Object.assign(p.frame, { l: p.frame.l + dx, r: p.frame.r + dx, t: p.frame.t + dy, b: p.frame.b + dy });
  });
  return parts.filter((p) => p.id !== null).map((p) => ({ id: p.id, ...p.frame }));
}
