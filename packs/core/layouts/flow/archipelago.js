// A picture of more than one island, set out as an archipelago (task e_auw7hb3v; the owner, 5 Nov 2026): each island
// laid out alone by the flow's own layout, so no two ever overlap, the islands set a sea apart in rows, what is read
// above what reads it, each with room inside its shore for its name over it and its own legend under it. A link between
// two islands (a finding read across) is routed through the sea at right angles, round every other island and every
// step, and crosses each shore once: where it leaves one island and enters the other is a gate, where the page shows
// what crosses. What lives on no island (a person) is a group of its own, with no shore. Layer: metrics. Pure: the
// answer and a layout in, one model of the whole picture out.

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/** Each island's items laid out alone by `run` (the flow's layout), and the links that join two of them. */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id));
    return { id, items: own, model: run({ items: own, links: links.filter((l) => set.has(l.from) && set.has(l.to)) }) };
  });
  const cross = links.filter((l) => where.has(l.from) && where.has(l.to) && where.get(l.from) !== where.get(l.to));
  return { groups, cross, where };
}

/** Entries of the given widths set out in lines no wider than `room`: each one's place, and the band's size. */
function band(widths, room, gap, row) {
  const at = [];
  let x = 0, y = 0, wide = 0;
  for (const w of widths) {
    if (x > 0 && x + w > room) (x = 0), (y += row);
    at.push([x, y]);
    x += w + gap;
    wide = Math.max(wide, x - gap);
  }
  return { at, w: wide, h: widths.length ? y + row : 0 };
}

/** Each group's level: what a link points to (what is read) is a level above what it comes from, cycles broken as met. */
function levels(groups, cross, where) {
  const below = new Map(groups.map((g) => [g.id, new Set()]));
  for (const l of cross) below.get(where.get(l.to))?.add(where.get(l.from));
  const level = new Map(groups.map((g) => [g.id, 0])), on = new Set();
  const down = (id, n) => {
    if (on.has(id) || (level.get(id) >= n && n > 0)) return;
    on.add(id);
    level.set(id, Math.max(level.get(id), n));
    for (const next of below.get(id)) down(next, n + 1);
    on.delete(id);
  };
  for (const g of groups) down(g.id, 0);
  return level;
}

/** A small binary heap of [cost, state]. */
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(item) {
      a.push(item);
      for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
      }
      return top;
    },
  };
}

/** The four ways a wire may run, as steps on the grid. */
const WAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIRS = WAYS.length;

/**
 * A wire at right angles from box `from` to box `to` on the grid `xs` by `ys`, round the `hard` rects, paying `cross` for
 * each stretch inside a `soft` one (a wire of the islands it joins) and `bend` for each turn, on no stretch in `used`.
 * Leaves and comes into each box square from the middle of a side. Null where there is no way.
 */
function route({ from, to, xs, ys, hard, soft, land, used, bend, cross }) {
  const ix = new Map(xs.map((v, i) => [v, i])), iy = new Map(ys.map((v, j) => [v, j]));
  const W = xs.length, H = ys.length;
  const at = (i, j) => j * W + i;
  // A stretch from a point to the next on the grid, keyed by its first point and its way.
  const hBlock = new Uint8Array(W * H), vBlock = new Uint8Array(W * H), hSoft = new Uint8Array(W * H), vSoft = new Uint8Array(W * H);
  /** The first index whose value is past `v` (strictly, or at least with `or`). */
  const after = (vs, v, or = false) => { let lo = 0, hi = vs.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (or ? vs[mid] >= v : vs[mid] > v) hi = mid; else lo = mid + 1; } return lo; };
  // A stretch is in a rect where the two overlap, its line strictly inside the rect's other span.
  const paint = (rects, h, v) => {
    for (const r of rects) {
      for (let j = after(ys, r.t); j < after(ys, r.b, true); j++) for (let i = Math.max(0, after(xs, r.l) - 1); i < Math.min(W - 1, after(xs, r.r, true)); i++) if (xs[i] < r.r && xs[i + 1] > r.l) h[at(i, j)] = 1;
      for (let i = after(xs, r.l); i < after(xs, r.r, true); i++) for (let j = Math.max(0, after(ys, r.t) - 1); j < Math.min(H - 1, after(ys, r.b, true)); j++) if (ys[j] < r.b && ys[j + 1] > r.t) v[at(i, j)] = 1;
    }
  };
  paint(hard, hBlock, vBlock);
  paint(soft, hSoft, vSoft);
  // A stretch over land costs twice what one through the sea does: a wire between islands keeps to the sea.
  const hLand = new Uint8Array(W * H), vLand = new Uint8Array(W * H);
  paint(land, hLand, vLand);
  const sides = (b) => [[(b.l + b.r) / 2, b.b, 2], [(b.l + b.r) / 2, b.t, DIRS - 1], [b.r, (b.t + b.b) / 2, 0], [b.l, (b.t + b.b) / 2, 1]];
  const ends = new Map(sides(to).map(([x, y, w]) => [at(ix.get(x), iy.get(y)), w ^ 1]));
  const best = new Float64Array(W * H * DIRS).fill(Infinity), back = new Int32Array(W * H * DIRS).fill(-1), q = heap();
  for (const [x, y, w] of sides(from)) { const s = at(ix.get(x), iy.get(y)) * DIRS + w; best[s] = 0; q.push([0, s]); }
  let goal = -1;
  while (q.size) {
    const [c, s] = q.pop();
    if (c > best[s]) continue;
    const p = Math.floor(s / DIRS), w = s % DIRS, i = p % W, j = (p - i) / W;
    if (ends.has(p) && ends.get(p) === w) { goal = s; break; }
    for (let n = 0; n < DIRS; n++) {
      const [di, dj] = WAYS[n], i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= W || j2 >= H) continue;
      const k = di ? at(Math.min(i, i2), j) : at(i, Math.min(j, j2));
      if ((di ? hBlock : vBlock)[k] || used.has(`${di ? 'h' : 'v'}${k}`)) continue;
      const len = di ? Math.abs(xs[i2] - xs[i]) : Math.abs(ys[j2] - ys[j]);
      const s2 = at(i2, j2) * DIRS + n, c2 = c + len * (1 + (di ? hLand : vLand)[k]) + (n === w ? 0 : bend) + ((di ? hSoft : vSoft)[k] ? cross : 0);
      if (c2 < best[s2]) (best[s2] = c2), (back[s2] = s), q.push([c2, s2]);
    }
  }
  if (goal < 0) return null;
  const points = [], taken = [];
  for (let s = goal; s >= 0; s = back[s]) {
    const p = Math.floor(s / DIRS), prev = back[s];
    points.push([xs[p % W], ys[(p - (p % W)) / W]]);
    if (prev >= 0) {
      const q2 = Math.floor(prev / DIRS), [a, b] = [p % W, (p - (p % W)) / W], [c, d] = [q2 % W, (q2 - (q2 % W)) / W];
      taken.push(a !== c ? `h${at(Math.min(a, c), b)}` : `v${at(a, Math.min(b, d))}`);
    }
  }
  points.reverse();
  // Only the corners: a point the line goes straight through is not one.
  const corners = points.filter((p, k) => k === 0 || k === points.length - 1 || !((p[0] === points[k - 1][0] && p[0] === points[k + 1][0]) || (p[1] === points[k - 1][1] && p[1] === points[k + 1][1])));
  return { points: corners, taken };
}

/** Where a line leaves the land (`inside` of a point) for good, from its start: the point on the shore it last crosses. */
function shoreOf(points, inside, step) {
  let last = null, was = true;
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= len; t += step) {
      const p = [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len], now = inside(p);
      if (was && !now) last = { at: p, way: [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])], k };
      was = now;
    }
  }
  return last;
}

/**
 * The whole picture: each group's model moved to its place, merged into one model as the flow's layout answers, with
 * the links between islands as ties routed through the sea (each with its `gates`, and `sea`: its line from the gate
 * of the reader's island to the gate of the finding's), and `islands`: each one's place,
 * the rects of its land, where its name and each entry of its legend go. `legends` gives each island's entries' widths, `names` how wide its name is.
 */
export function compose({ groups, cross, where }, { legends, names = new Map(), sizes, crossings }) {
  const z = (name) => sizes[`flow_island_${name}`];
  const [PAD, NAME, SEA, GAP, ROW, WIRE, CLOSE] = ['pad', 'name_room', 'sea', 'legend_gap', 'legend_row', 'wire_pad', 'close'].map(z);
  const M = sizes.flow_margin, ROOM = sizes.flow_wire_room;
  const blocks = groups.map((g) => {
    const shore = g.id !== null, widths = legends.get(g.id) ?? [];
    // The legend a column at its right, so its top and foot stay open to the wires that cross.
    const legend = band(widths, Math.max(0, ...widths), GAP, ROW);
    const [cx, cy] = shore ? [PAD, PAD + NAME] : [0, 0];
    return { ...g, shore, legend, cx, cy, w: cx * 2 + g.model.width + (legend.w ? GAP + legend.w : 0), h: cy + Math.max(g.model.height, legend.h) + (shore ? PAD : 0) };
  });
  // Rows by level, a sea apart, each row in the middle of the widest.
  const level = levels(groups, cross, where), rows = [];
  for (const b of blocks) (rows[level.get(b.id)] ??= []).push(b);
  const dense = rows.filter(Boolean), widthOf = (row) => row.reduce((s, b) => s + b.w, 0) + SEA * (row.length - 1);
  const widest = Math.max(...dense.map(widthOf));
  let top = M;
  for (const row of dense) {
    let left = M + (widest - widthOf(row)) / 2;
    for (const b of row) (b.x = left), (b.y = top), (left += b.w + SEA);
    top += Math.max(...row.map((b) => b.h)) + SEA;
  }
  // One model: every place moved by its group's.
  const nodes = new Map(), x = new Map(), y = new Map(), chains = [], ties = [], all = [], breaks = [], potential = new Set();
  const shift = (dx, dy) => (p) => [p[0] + dx, p[1] + dy];
  for (const b of blocks) {
    const [dx, dy] = [b.x + b.cx, b.y + b.cy], m = b.model, move = shift(dx, dy);
    for (const [id, n] of m.nodes) if (m.x.has(id)) (nodes.set(id, n), x.set(id, m.x.get(id) + dx), y.set(id, m.y.get(id) + dy));
    all.push(...m.all);
    for (const id of m.potential) potential.add(id);
    const moved = (w) => ({ ...w, points: w.points.map(move), ...(w.gaps && { gaps: w.gaps.map(move) }) });
    chains.push(...m.chains.map(moved));
    ties.push(...m.ties.map(moved));
    breaks.push(...m.breaks.map((k) => ({ ...k, at: move(k.at) })));
    b.wires = [...m.chains, ...m.ties].map(moved);
  }
  const box = (id, pad = 0) => ({ l: x.get(id) - nodes.get(id).w / 2 - pad, r: x.get(id) + nodes.get(id).w / 2 + pad, t: y.get(id) - nodes.get(id).h / 2 - pad, b: y.get(id) + nodes.get(id).h / 2 + pad });
  const rect = (l, t, r, b) => ({ l, t, r, b });
  // Each island's land: its steps and its own wires, each taken in by its margin, its name's room and its legend.
  for (const b of blocks.filter((k) => k.shore)) {
    const steps = b.model.all.filter((n) => !n.dummy).map((n) => box(n.id, PAD));
    const wires = b.wires.flatMap((w) => w.points.slice(1).map((p, k) => { const q = w.points[k]; return rect(Math.min(p[0], q[0]) - WIRE, Math.min(p[1], q[1]) - WIRE, Math.max(p[0], q[0]) + WIRE, Math.max(p[1], q[1]) + WIRE); }));
    const first = steps.reduce((p, q) => (q.t < p.t || (q.t === p.t && q.l < p.l) ? q : p), steps[0]);
    b.name = [first.l, first.t - NAME / 2];
    const named = rect(first.l, first.t - NAME, first.r, first.t + PAD);
    const lx = b.x + b.cx + b.model.width + GAP, ly = b.y + b.cy;
    b.entries = b.legend.at.map(([ex, ey]) => [lx + ex, ly + ey]);
    // The legend's land reaches the island's steps, so the two are one.
    const legend = b.legend.h ? [rect(Math.min(lx - PAD, Math.max(...steps.map((r) => r.r))), ly - PAD, lx + b.legend.w + PAD, ly + b.legend.h + PAD)] : [];
    b.land = [...steps, ...wires, named, ...legend];
    // What a wire between islands goes round, as it goes round a step: the name as wide as it is, and the legend.
    b.kept = [rect(first.l, first.t - NAME, first.l + (names.get(b.id) ?? 0), first.t), ...(b.legend.h ? [rect(lx, ly, lx + b.legend.w, ly + b.legend.h)] : [])].map((r) => rect(r.l - ROOM, r.t - ROOM, r.r + ROOM, r.b + ROOM));
  }
  // The links between islands, each through the sea, as ties: no stretch shared, round every step and other island.
  const islandOf = (id) => where.get(nodes.get(id)?.item?.id ?? id) ?? null;
  const landOf = new Map(blocks.filter((b) => b.shore).map((b) => [b.id, b]));
  const inLand = (b) => (p) => b.land.some((r) => p[0] >= r.l - CLOSE && p[0] <= r.r + CLOSE && p[1] >= r.t - CLOSE && p[1] <= r.b + CLOSE);
  const used = new Set(), boxes = [...nodes.keys()].filter((id) => x.has(id));
  const coords = (rects, axis) => rects.flatMap((r) => (axis ? [r.t, r.b] : [r.l, r.r]));
  const hardAll = boxes.map((id) => box(id, ROOM)), outlines = blocks.filter((b) => b.shore).map((b) => ({ id: b.id, r: rect(b.x - CLOSE, b.y - CLOSE, b.x + b.w + CLOSE, b.y + b.h + CLOSE) }));
  // The lines a wire may run on: every edge, and a line between each two, so two wires have room side by side.
  const tracks = (vs) => { const s = [...new Set(vs)].sort((a, b) => a - b); return [...new Set([...s, ...s.slice(1).map((v, k) => (v + s[k]) / 2)])].sort((a, b) => a - b); };
  // One grid for every wire, so no two take one stretch: every edge, the middle of every box's sides, and round the outside.
  const raw = boxes.map((id) => box(id)), every = [...hardAll, ...raw, ...outlines.map((o) => o.r), ...blocks.flatMap((b) => b.kept ?? [])];
  const xs = tracks([...coords(every, 0), ...raw.map((e) => (e.l + e.r) / 2), M / 2]), ys = tracks([...coords(every, 1), ...raw.map((e) => (e.t + e.b) / 2), M / 2]);
  const routed = [];
  const most = sizes.flow_island_route_most;
  for (const l of cross.filter((k) => x.has(k.from) && x.has(k.to))) {
    const [a, c] = [l.from, l.to], [ia, ic] = [islandOf(a), islandOf(c)];
    const ends = [box(a), box(c)];
    const hard = [...boxes.filter((id) => id !== a && id !== c).map((id) => box(id, ROOM)), ...ends, ...blocks.flatMap((b) => b.kept ?? []), ...outlines.filter((o) => o.id !== ia && o.id !== ic).map((o) => o.r)];
    const soft = blocks.filter((b) => b.id === ia || b.id === ic).flatMap((b) => b.wires.flatMap((w) => w.points.slice(1).map((p, k) => { const q = w.points[k]; return rect(Math.min(p[0], q[0]) - 1, Math.min(p[1], q[1]) - 1, Math.max(p[0], q[0]) + 1, Math.max(p[1], q[1]) + 1); })));
    const found = routed.length < crossings && xs.length * ys.length <= most ? route({ from: ends[0], to: ends[1], xs, ys, hard, soft, land: blocks.filter((b) => b.shore && (b.id === ia || b.id === ic)).flatMap((b) => b.land), used, bend: sizes.flow_cost_bend / 10, cross: sizes.flow_cost_crossing / 10 }) : null;
    const points = found?.points ?? [[(ends[0].l + ends[0].r) / 2, ends[0].b], [(ends[0].l + ends[0].r) / 2, (ends[0].b + ends[1].t) / 2], [(ends[1].l + ends[1].r) / 2, (ends[0].b + ends[1].t) / 2], [(ends[1].l + ends[1].r) / 2, ends[1].t]];
    for (const k of found?.taken ?? []) used.add(k);
    // A gate only where it crosses from one island to another: a person lives on none, and a wait on them is no finding.
    const gates = [ia, ic].map((id, k) => (landOf.has(ia) && landOf.has(ic) ? { island: id, ...shoreOf(k ? [...points].reverse() : points, inLand(landOf.get(id)), 1) } : null)).filter((g) => g?.at);
    // What crosses is named once, in the sea: on the longest stretch between the two gates.
    let label = null, sea = null;
    if (gates.length === 2) {
      const [out, into] = gates, n = points.length;
      sea = [out.at, ...points.slice(out.k, n - into.k), into.at];
      for (let k = 1; k < sea.length; k++) {
        const [p, q] = [sea[k - 1], sea[k]], room = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
        if (!label || room > label.room) label = { at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], across: p[1] === q[1], room };
      }
    }
    const tie = { a, b: c, type: l.type ?? l.kind, headAt: 'end', points, crossing: true, gates, ...(label && { label }), ...(sea && { sea }), ...(l.pending && { pending: l.pending }) };
    routed.push(tie);
    ties.push(tie);
  }
  const extent = [...blocks.map((b) => [b.x + b.w, b.y + b.h]), ...routed.flatMap((t) => t.points)];
  return {
    nodes, all, chains, ties, breaks, potential, x, y,
    width: Math.max(...extent.map((p) => p[0])) + M, height: Math.max(...extent.map((p) => p[1])) + M,
    islands: blocks.filter((b) => b.shore).map((b) => ({ id: b.id, land: b.land, name: b.name, entries: b.entries, steps: new Set(b.items.map((i) => i.id)) })),
  };
}
