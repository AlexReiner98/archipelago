// A system's wires, routed: at right angles only, as in the flow, each on a track of its own in the gap below the
// row it leaves; then the rows' heights, the places' boxes and the whole size. Given what layout.js has placed.

/** Route the wires of what is placed, and size the picture. */
export function route({ nodes, chains, layers, x, byId, order, colLeft, colRight, measure, prior, steady, health, sizes }) {
  const { SLOT, TRACK, LAYER_GAP, PAD, LEAD_OUT, LEAD_IN, HEAD, MARGIN, PLACE_TEXT, PLACE_NAME_PAD } = sizes;
  // ---- Routing, at right angles only, as in the flow: a wire drops from the foot of a part, runs across on a track
  // of its own in the gap below, and drops to the head of the next; each has its own place on the parts it joins.
  const all = [...nodes.values()];
  const segs = chains.flatMap((c) => c.path.slice(1).map((v, k) => ({ chain: c, u: c.path[k], v, gap: nodes.get(c.path[k]).layer })));
  const range = (id) => {
    const n = nodes.get(id), half = n.dummy ? 0 : n.w * (n.shape === 'diamond' ? 0.12 : 0.4);
    return [x.get(id) - half, x.get(id) + half];
  };
  const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  const slots = (id, list, want) => {
    const [lo, hi] = range(id), k = list.length;
    const step = k > 1 ? Math.min(SLOT, (hi - lo) / (k - 1)) : 0;
    const v = list.map((sg) => clampTo(want(sg), [lo, hi]));
    for (let i = 1; i < k; i++) v[i] = Math.max(v[i], v[i - 1] + step);
    if (k) v[k - 1] = Math.min(v[k - 1], hi);
    for (let i = k - 2; i >= 0; i--) v[i] = Math.min(v[i], v[i + 1] - step);
    return v;
  };
  const leaving = (id) => segs.filter((sg) => sg.u === id), arriving = (id) => segs.filter((sg) => sg.v === id);
  for (const n of all) {
    const list = leaving(n.id).sort((p, q) => x.get(p.v) - x.get(q.v));
    slots(n.id, list, (sg) => clampTo(x.get(sg.u), range(sg.v))).forEach((v, i) => (list[i].fx = v));
  }
  for (const n of all) {
    const list = arriving(n.id).sort((p, q) => p.fx - q.fx);
    slots(n.id, list, (sg) => sg.fx).forEach((v, i) => (list[i].hx = v));
  }
  // A port that is its part's only one that way follows the other end of its wire as far as the part allows.
  for (const sg of segs) {
    if (leaving(sg.u).length === 1) sg.fx = clampTo(sg.hx, range(sg.u));
    if (arriving(sg.v).length === 1) sg.hx = clampTo(sg.fx, range(sg.v));
  }
  // Fewer turns (steady): where the parts at the two ends of a stretch overlap across, both ports move to one x in
  // the overlap, nearest where they were, and the stretch drops straight, if that keeps LANE from the other ports.
  const PORT_LANE = 6;
  for (const sg of steady ? segs : []) {
    if (Math.abs(sg.fx - sg.hx) < 0.5) continue;
    const [a1, a2] = range(sg.u), [b1, b2] = range(sg.v), lo = Math.max(a1, b1), hi = Math.min(a2, b2);
    if (lo > hi) continue;
    const t = clampTo((sg.fx + sg.hx) / 2, [lo, hi]);
    const clear = segs.every((o) => o === sg || ((o.u !== sg.u || Math.abs(o.fx - t) >= PORT_LANE) && (o.v !== sg.v || Math.abs(o.hx - t) >= PORT_LANE)));
    if (clear) sg.fx = sg.hx = t;
  }
  for (const sg of segs) [sg.x1, sg.x2] = [Math.min(sg.fx, sg.hx), Math.max(sg.fx, sg.hx)];
  const inside = (v, sg) => v > sg.x1 + 0.5 && v < sg.x2 - 0.5;
  const cost = (a, b) => Number(inside(a.hx, b)) + Number(inside(b.fx, a));
  const tracks = layers.map(() => []);
  for (const sg of [...segs].sort((p, q) => q.x2 - q.x1 - (p.x2 - p.x1))) {
    const list = tracks[sg.gap];
    let bestAt = 0, least = Infinity;
    for (let k = 0; k <= list.length; k++) {
      const c = list.slice(0, k).reduce((s, o) => s + cost(o, sg), 0) + list.slice(k).reduce((s, o) => s + cost(sg, o), 0);
      if (c < least) ((least = c), (bestAt = k));
    }
    list.splice(bestAt, 0, sg);
  }
  // Rows: each layer as tall as its tallest part; each gap holds the foot of the boxes above, the tracks, and the
  // names of the boxes that start below.
  const y = new Map(), rowTop = [], rowBottom = [], rooms = [];
  let cy = MARGIN + HEAD;
  layers.forEach((ids, k) => {
    const tall = Math.max(24, ...ids.map((id) => nodes.get(id).h));
    rowTop[k] = cy;
    for (const id of ids) y.set(id, cy + tall / 2);
    cy += tall;
    rowBottom[k] = cy;
    const n = tracks[k].length;
    // With a prior, a gap between rows never shrinks back: it grows once, when a wire first needs the room.
    const room = Math.max(LAYER_GAP, PAD + LEAD_OUT + Math.max(0, n - 1) * TRACK + LEAD_IN + HEAD, prior?.rooms[k] ?? 0);
    rooms[k] = room;
    const first = cy + PAD + LEAD_OUT + (room - PAD - LEAD_OUT - LEAD_IN - HEAD - Math.max(0, n - 1) * TRACK) / 2;
    tracks[k].forEach((sg, i) => (sg.y = first + i * TRACK));
    cy += room;
  });
  // The places: a box around each, as wide as its own parts (and its name), from the first layer it holds a part in
  // to the last. A place stacked on another is boxed apart from it, above it.
  const boxes = !steady
    ? order.filter((c) => c !== null).map((c) => {
        const ks = all.filter((n) => n.col === c && !n.dummy).map((n) => n.layer);
        const [k0, k1] = [Math.min(...ks), Math.max(...ks)];
        return { id: c, item: byId.get(c), health: health(byId.get(c)), x: colLeft.get(c) - PAD, y: rowTop[k0] - HEAD, w: colRight.get(c) - colLeft.get(c) + 2 * PAD, h: rowBottom[k1] - rowTop[k0] + HEAD + PAD };
      })
    : [...new Set(all.filter((n) => !n.dummy && n.home !== null).map((n) => n.home))].map((c) => {
    const mine = all.filter((n) => !n.dummy && n.home === c), ks = mine.map((n) => n.layer);
    const [k0, k1] = [Math.min(...ks), Math.max(...ks)];
    const lo = Math.min(...mine.map((n) => x.get(n.id) - n.w / 2)), hi = Math.max(lo + measure(byId.get(c).title, PLACE_TEXT) + PLACE_NAME_PAD, ...mine.map((n) => x.get(n.id) + n.w / 2));
    return { id: c, item: byId.get(c), health: health(byId.get(c)), x: lo - PAD, y: rowTop[k0] - HEAD, w: hi - lo + 2 * PAD, h: rowBottom[k1] - rowTop[k0] + HEAD + PAD };
  });
  const width = Math.max(...[...colRight.values()]) + PAD + MARGIN;
  const left = Math.min(...[...colLeft.values()]) - PAD - MARGIN;
  const height = Math.max(rowBottom.at(-1) + PAD, ...boxes.map((b) => b.y + b.h)) + MARGIN;

  // A part's edge at a given x: its foot or its head, along a diamond's slope where it is one.
  const edgeY = (id, px, below) => {
    const n = nodes.get(id);
    if (n.dummy) return y.get(id);
    const slope = n.shape === 'diamond' ? (Math.abs(px - x.get(id)) * n.h) / n.w : 0;
    return y.get(id) + (below ? 1 : -1) * (n.h / 2 - slope);
  };
  // Two wires never run down side by side (steady). A drop is a foot (fx, from a part down to its track) or a head (hx, from
  // its track down to a part); a drop through a waypoint is the head of one stretch and the foot of the next, and the
  // two move as one. Where a drop lies within LANE of another wire's, it slides along to a clear lane: a port only
  // along its part, a waypoint only where it runs through no part.
  const LANE = 6;
  const drops = () => segs.flatMap((sg) => [
    { sg, end: 'fx', x: sg.fx, y1: edgeY(sg.u, sg.fx, true), y2: sg.y, at: sg.u },
    { sg, end: 'hx', x: sg.hx, y1: sg.y, y2: edgeY(sg.v, sg.hx, false), at: sg.v },
  ]);
  const spans = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)) > 2;
  const partAt = (vx, ya, yb) => all.some((n) => !n.dummy && Math.abs(vx - x.get(n.id)) < n.w / 2 + 2 && spans(ya, yb, y.get(n.id) - n.h / 2, y.get(n.id) + n.h / 2));
  for (let pass = 0; steady && pass < 6; pass++) {
    let slid = false;
    const list = drops();
    for (const d of list) {
      const clash = (vx) => list.some((o) => o.sg.chain !== d.sg.chain && o !== d && Math.abs(o.x - vx) < LANE && spans(o.y1, o.y2, d.y1, d.y2));
      if (!clash(d.x)) continue;
      // The drop's partner through a waypoint, which slides with it.
      const node = nodes.get(d.at), partner = node.dummy ? segs.find((o) => o.chain === d.sg.chain && (d.end === 'hx' ? o.u === d.at : o.v === d.at)) : null;
      for (const step of [1, -1, 2, -2, 3, -3, 4, -4]) {
        const vx = d.x + step * LANE;
        if (!node.dummy && (vx < range(d.at)[0] || vx > range(d.at)[1])) continue;
        if (clash(vx) || (node.dummy && partAt(vx, d.y1, d.y2))) continue;
        d.sg[d.end] = vx;
        if (partner) partner[d.end === 'hx' ? 'fx' : 'hx'] = vx;
        if (node.dummy) x.set(d.at, vx);
        d.x = vx;
        slid = true;
        break;
      }
    }
    if (!slid) break;
  }
  for (const sg of segs) sg.points = [[sg.fx, edgeY(sg.u, sg.fx, true)], [sg.fx, sg.y], [sg.hx, sg.y], [sg.hx, edgeY(sg.v, sg.hx, false)]];
  for (const c of chains) c.points = segs.filter((sg) => sg.chain === c).flatMap((sg, k) => (k ? sg.points.slice(1) : sg.points));
  // Where a drop passes over another wire's track, the drop is broken, as in the flow.
  const breaks = [];
  for (const sg of segs)
    for (const [p, q] of [[sg.points[0], sg.points[1]], [sg.points[2], sg.points[3]]])
      for (const o of tracks[sg.gap]) if (o !== sg && inside(p[0], o) && o.y > Math.min(p[1], q[1]) + 1 && o.y < Math.max(p[1], q[1]) - 1) breaks.push([p[0], o.y]);

  return { all, boxes, breaks, y, width, height, left: steady ? Math.min(0, left) : 0, rooms };
}
