// A system's layout, apart from its drawing: which items of a lens answer are its parts, which hold them (where
// each runs: a host, a cloud, a machine), the wires between the parts, and where each sits. Read from the top down
// as the flow is, but the other way round: a part sits above what it calls, so a request falls down the page from
// whoever sends it to where it is kept. Each place that holds parts is a column of its own, drawn as a box around
// them, so nothing of one place ever sits inside another's box; the parts are layered by longest path, ordered in
// their column by barycentre sweeps, and the wires routed at right angles, each on a track of its own. Pure: an
// answer in, geometry out; `measure(text, px)` gives a title's width at a size.


/** How a part is, read from its status word alone: no type is named. */
const HEALTH = {
  ok: ['up', 'available', 'in_use', 'active', 'running', 'live', 'shipped', 'built', 'current', 'happened', 'done'],
  warn: ['degraded', 'mitigated', 'waiting', 'investigating', 'unavailable_partly'],
  down: ['down', 'unavailable', 'failed', 'broken', 'open_incident'],
  building: ['wiring', 'building', 'doing', 'in_progress', 'testing'],
  planned: ['planned', 'todo', 'draft', 'upcoming', 'raw', 'untested'],
  standby: ['standby', 'idle', 'paused'],
};
export function health(item) {
  if (!item.open) return 'gone';
  for (const [h, words] of Object.entries(HEALTH)) if (words.includes(item.status)) return h;
  return 'unknown';
}
/** A wire's state: what the link says of itself (props.state), else what its two ends make it. */
export function wireState(link, a, b) {
  if (['wired', 'planned', 'broken'].includes(link.state)) return link.state;
  const ends = [health(a), health(b)];
  if (ends.includes('down')) return 'broken';
  if (ends.some((h) => h === 'planned' || h === 'building' || h === 'gone')) return 'planned';
  // A wire to a part stopped on purpose is there, and carries nothing until it runs again.
  if (ends.includes('standby')) return 'standby';
  return 'wired';
}
/** A part's outline, by its role where its type sends one, else by its kind. */
const shapeOf = (i) => (['data', 'storage', 'database', 'queue'].includes(i.role) ? 'store' : ['client', 'person', 'user'].includes(i.role) || i.kind === 'actor' ? 'pill' : i.kind === 'question' ? 'diamond' : 'box');

/** The parts (each with its place x, y and size w, h), the places that hold them, the wires and the whole size. */
/**
 * Every length it lays out by is the style's (`sizes`, arch_*): the house style in packs/core/pack.json names each.
 * HEAD and PAD are the room inside a place's box: its name above its parts, and a margin around them.
 */
export function layout({ items, links, rootId, measure, sizes }) {
  const need = (name) => {
    if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the architecture lays out by`);
    return sizes[name];
  };
  const [LAYER_GAP, NODE_GAP, COL_GAP, MARGIN, MAX_TEXT, TRACK, SLOT, LEAD_OUT, LEAD_IN, HEAD, PAD] = ['layer_gap', 'node_gap', 'col_gap', 'margin', 'max_text', 'track', 'slot', 'lead_out', 'lead_in', 'head', 'pad'].map((n) => need(`arch_${n}`));
  const [TEXT, PLACE_TEXT, PLACE_NAME_PAD, DIAMOND_PAD, DIAMOND_H, STORE_PAD, STORE_H, BOX_PAD, BOX_H] = ['text', 'place_text', 'place_name_pad', 'diamond_pad', 'diamond_height', 'store_pad', 'store_height', 'box_pad', 'box_height'].map((n) => need(`arch_${n}`));
  const byId = new Map(items.map((i) => [i.id, i]));
  const holds = new Map();
  for (const i of items) if (i.inside && byId.has(i.inside)) holds.set(i.inside, [...(holds.get(i.inside) ?? []), i.id]);
  // The place an item is drawn in: what holds it just under the start of the picture.
  const top = (id) => {
    let cur = id;
    for (let steps = 0; steps < 64; steps++) {
      const up = byId.get(cur)?.inside;
      if (!up || up === rootId || !byId.has(up)) return cur;
      cur = up;
    }
    return cur;
  };
  const wiredIds = new Set(links.flatMap((l) => [l.from, l.to]));
  // A place is what holds, just under the start, something wired; what holds only work on it is a part.
  const holdsWired = (id, depth = 0) => depth < 64 && (holds.get(id) ?? []).some((kid) => wiredIds.has(kid) || holdsWired(kid, depth + 1));
  const isGroup = (id) => id !== rootId && top(id) === id && holdsWired(id);

  // ---- Parts: everything but the start and the places; the start too, when it is wired to something in it.
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => a.place - b.place)) {
    if (isGroup(i.id) || (i.id === rootId && !wiredIds.has(i.id))) continue;
    const col = top(i.id);
    nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i), health: health(i), col: col === i.id || i.id === rootId ? null : col });
  }
  // What sits in a part but is wired to nothing (work on it, a note) is a mark on that part, not a part.
  for (const n of [...nodes.values()]) {
    const host = nodes.get(n.item.inside);
    if (host && !wiredIds.has(n.id)) (nodes.delete(n.id), (host.notes ??= []).push(n.item));
  }
  const groups = [...new Set([...nodes.values()].map((n) => n.col).filter(Boolean))].map((id) => byId.get(id));
  if (!nodes.size) return { nodes, all: [], groups: [], boxes: [], chains: [], breaks: [], x: new Map(), y: new Map(), width: 0, height: 0 };

  // ---- Wires: a calls b when a link goes from a to b (a depends on b, needs it, sends to it). One a pair.
  let edges = [];
  const seen = new Set();
  for (const l of links) {
    if (!nodes.has(l.from) || !nodes.has(l.to) || l.from === l.to) continue;
    const key = [l.from, l.to].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a: l.from, b: l.to, link: l, ...(l.says && { says: l.says }), state: wireState(l, nodes.get(l.from).item, nodes.get(l.to).item) });
  }
  // A loop is drawn with one wire turned back, so the rest still reads down the page.
  const colour = new Map();
  const visit = (id) => {
    colour.set(id, 1);
    for (const e of edges.filter((f) => f.a === id)) {
      if (colour.get(e.b) === 1) ([e.a, e.b] = [e.b, e.a]), (e.back = true);
      else if (!colour.get(e.b)) visit(e.b);
    }
    colour.set(id, 2);
  };
  for (const id of nodes.keys()) if (!colour.get(id)) visit(id);

  // ---- Sizes.
  for (const n of nodes.values()) {
    const text = Math.min(measure(n.item.title, TEXT), MAX_TEXT);
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H];
    else if (n.shape === 'store') [n.w, n.h] = [text + STORE_PAD, STORE_H];
    else [n.w, n.h] = [text + BOX_PAD, BOX_H];
  }

  // ---- Layers, from the bottom up: what calls nothing (a store, a model, a service outside) on the last row, and
  // each part one above the highest it calls, so a part sits just above what it sends to.
  const outs = (id) => edges.filter((e) => e.a === id).map((e) => e.b);
  const rises = new Map();
  const rise = (id) => {
    if (!rises.has(id)) rises.set(id, Math.max(0, ...outs(id).map((b) => rise(b) + 1)));
    return rises.get(id);
  };
  for (const id of nodes.keys()) rise(id);
  const tallest = Math.max(...rises.values());
  const layerOf = new Map([...rises].map(([id, k]) => [id, tallest - k]));
  for (const [id, k] of layerOf) nodes.get(id).layer = k;
  // A wire that passes a layer has a waypoint there, in the column it is going to, so it falls inside that place.
  const chains = edges.map((e) => {
    const path = [e.a];
    for (let k = layerOf.get(e.a) + 1; k < layerOf.get(e.b); k++) {
      const id = `${e.a}>${e.b}@${k}`;
      nodes.set(id, { id, dummy: true, layer: k, col: nodes.get(e.b).col, w: 4, h: 0 });
      path.push(id);
    }
    path.push(e.b);
    return { ...e, key: `${e.a} ${e.b}`, path };
  });

  // ---- Columns: the order that keeps the wires between places shortest; the parts no place holds first.
  const cols = [null, ...groups.map((g) => g.id)].filter((c) => [...nodes.values()].some((n) => n.col === c));
  const across = chains.map((c) => [nodes.get(c.a).col, nodes.get(c.b).col]).filter(([p, q]) => p !== q);
  const permute = (list) => (list.length <= 1 ? [list] : list.flatMap((x, k) => permute([...list.slice(0, k), ...list.slice(k + 1)]).map((rest) => [x, ...rest])));
  const loose = cols[0] === null ? [null] : [];
  let order = cols;
  if (cols.length - loose.length <= 7) {
    let least = Infinity;
    for (const p of permute(cols.filter((c) => c !== null))) {
      const at = new Map([...loose, ...p].map((c, k) => [c, k]));
      const cost = across.reduce((s, [p1, q1]) => s + Math.abs(at.get(p1) - at.get(q1)), 0);
      if (cost < least) ((least = cost), (order = [...loose, ...p]));
    }
  }
  const colAt = new Map(order.map((c, k) => [c, k]));

  // ---- Order in each layer: column by column, and within a column by barycentre sweeps, kept where fewest cross.
  const up = new Map([...nodes.keys()].map((id) => [id, []])), down = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const c of chains) for (let k = 1; k < c.path.length; k++) (down.get(c.path[k - 1]).push(c.path[k]), up.get(c.path[k]).push(c.path[k - 1]));
  const layers = [];
  for (const n of nodes.values()) (layers[n.layer] ??= []).push(n.id);
  for (let k = 0; k < layers.length; k++) layers[k] ??= [];
  const pos = new Map();
  const index = () => layers.forEach((list) => list.forEach((id, k) => pos.set(id, k)));
  const byColumn = (list, key) => list.sort((p, q) => colAt.get(nodes.get(p).col) - colAt.get(nodes.get(q).col) || key(p) - key(q));
  layers.forEach((list) => byColumn(list, (id) => pos.get(id) ?? 0));
  index();
  const crossings = () => {
    let count = 0;
    for (let k = 1; k < layers.length; k++) {
      const pairs = layers[k].flatMap((b) => up.get(b).map((a) => [pos.get(a), pos.get(b)]));
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) count++;
    }
    return count;
  };
  const sweep = (k, toward) => {
    const bary = new Map(layers[k].map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, x) => s + pos.get(x), 0) / toward.get(id).length : pos.get(id)]));
    byColumn(layers[k], (id) => bary.get(id));
    index();
  };
  let best = layers.map((l) => [...l]), fewest = crossings();
  for (let round = 0; round < 16 && fewest > 0; round++) {
    if (round % 2 === 0) for (let k = 1; k < layers.length; k++) sweep(k, up);
    else for (let k = layers.length - 2; k >= 0; k--) sweep(k, down);
    const count = crossings();
    if (count < fewest) ((fewest = count), (best = layers.map((l) => [...l])));
  }
  layers.splice(0, layers.length, ...best);
  index();

  // ---- Places across: each column as wide as its widest layer, then each part pulled toward what it is wired to.
  const gap = (a, b) => (nodes.get(a).dummy || nodes.get(b).dummy ? NODE_GAP / 2 : NODE_GAP);
  const cell = (k, c) => layers[k].filter((id) => nodes.get(id).col === c);
  const widthOf = (ids) => ids.reduce((s, id, k) => s + nodes.get(id).w + (k ? gap(ids[k - 1], id) : 0), 0);
  const colLeft = new Map(), colRight = new Map();
  let at = MARGIN + PAD;
  for (const c of order) {
    const w = Math.max(...layers.map((_, k) => widthOf(cell(k, c))), c === null ? 0 : measure(byId.get(c).title, PLACE_TEXT) + PLACE_NAME_PAD);
    colLeft.set(c, at);
    colRight.set(c, at + w);
    at += w + COL_GAP + 2 * PAD;
  }
  const x = new Map();
  for (let k = 0; k < layers.length; k++)
    for (const c of order) {
      const ids = cell(k, c);
      let cur = (colLeft.get(c) + colRight.get(c)) / 2 - widthOf(ids) / 2;
      for (const id of ids) (x.set(id, cur + nodes.get(id).w / 2), (cur += nodes.get(id).w + NODE_GAP));
    }
  // Wanted places resolved within a cell: in order, apart, inside the column.
  const settle = (ids, want) => {
    const c = nodes.get(ids[0]).col, lo = colLeft.get(c), hi = colRight.get(c);
    const v = ids.map((id) => want.get(id));
    ids.forEach((id, i) => (v[i] = Math.max(v[i], lo + nodes.get(id).w / 2, i ? v[i - 1] + (nodes.get(ids[i - 1]).w + nodes.get(id).w) / 2 + gap(ids[i - 1], id) : -Infinity)));
    for (let i = ids.length - 1; i >= 0; i--) v[i] = Math.min(v[i], hi - nodes.get(ids[i]).w / 2, i < ids.length - 1 ? v[i + 1] - (nodes.get(ids[i]).w + nodes.get(ids[i + 1]).w) / 2 - gap(ids[i], ids[i + 1]) : Infinity);
    ids.forEach((id, i) => x.set(id, v[i]));
  };
  const pull = (k, toward) => {
    for (const c of order) {
      const ids = cell(k, c);
      if (!ids.length) continue;
      settle(ids, new Map(ids.map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, n) => s + x.get(n), 0) / toward.get(id).length : x.get(id)])));
    }
  };
  for (let round = 0; round < 6; round++) {
    for (let k = 1; k < layers.length; k++) pull(k, up);
    for (let k = layers.length - 2; k >= 0; k--) pull(k, down);
  }

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
  const y = new Map(), rowTop = [], rowBottom = [];
  let cy = MARGIN + HEAD;
  layers.forEach((ids, k) => {
    const tall = Math.max(24, ...ids.map((id) => nodes.get(id).h));
    rowTop[k] = cy;
    for (const id of ids) y.set(id, cy + tall / 2);
    cy += tall;
    rowBottom[k] = cy;
    const n = tracks[k].length;
    const room = Math.max(LAYER_GAP, PAD + LEAD_OUT + Math.max(0, n - 1) * TRACK + LEAD_IN + HEAD);
    const first = cy + PAD + LEAD_OUT + (room - PAD - LEAD_OUT - LEAD_IN - HEAD - Math.max(0, n - 1) * TRACK) / 2;
    tracks[k].forEach((sg, i) => (sg.y = first + i * TRACK));
    cy += room;
  });
  // The places: a box around each column, from the first layer it holds a part in to the last.
  const boxes = order.filter((c) => c !== null).map((c) => {
    const ks = all.filter((n) => n.col === c && !n.dummy).map((n) => n.layer);
    const [k0, k1] = [Math.min(...ks), Math.max(...ks)];
    return { id: c, item: byId.get(c), health: health(byId.get(c)), x: colLeft.get(c) - PAD, y: rowTop[k0] - HEAD, w: colRight.get(c) - colLeft.get(c) + 2 * PAD, h: rowBottom[k1] - rowTop[k0] + HEAD + PAD };
  });
  const width = Math.max(...[...colRight.values()]) + PAD + MARGIN;
  const height = Math.max(rowBottom.at(-1) + PAD, ...boxes.map((b) => b.y + b.h)) + MARGIN;

  // A part's edge at a given x: its foot or its head, along a diamond's slope where it is one.
  const edgeY = (id, px, below) => {
    const n = nodes.get(id);
    if (n.dummy) return y.get(id);
    const slope = n.shape === 'diamond' ? (Math.abs(px - x.get(id)) * n.h) / n.w : 0;
    return y.get(id) + (below ? 1 : -1) * (n.h / 2 - slope);
  };
  for (const sg of segs) sg.points = [[sg.fx, edgeY(sg.u, sg.fx, true)], [sg.fx, sg.y], [sg.hx, sg.y], [sg.hx, edgeY(sg.v, sg.hx, false)]];
  for (const c of chains) c.points = segs.filter((sg) => sg.chain === c).flatMap((sg, k) => (k ? sg.points.slice(1) : sg.points));
  // Where a drop passes over another wire's track, the drop is broken, as in the flow.
  const breaks = [];
  for (const sg of segs)
    for (const [p, q] of [[sg.points[0], sg.points[1]], [sg.points[2], sg.points[3]]])
      for (const o of tracks[sg.gap]) if (o !== sg && inside(p[0], o) && o.y > Math.min(p[1], q[1]) + 1 && o.y < Math.max(p[1], q[1]) - 1) breaks.push([p[0], o.y]);

  return { nodes, all, groups, boxes, chains, breaks, x, y, width, height };
}
