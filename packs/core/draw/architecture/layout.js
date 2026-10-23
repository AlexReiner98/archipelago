// A system's layout, apart from its drawing: which items of a lens answer are its parts, which hold them (where
// each runs: a host, a cloud, a machine), the wires between the parts, and where each sits. Read from the top down
// as the flow is, but the other way round: a part sits above what it calls, so a request falls down the page from
// whoever sends it to where it is kept. Each place that holds parts is a column of its own, drawn as a box around
// them, so nothing of one place ever sits inside another's box; the parts are layered by longest path, ordered in
// their column by barycentre sweeps, and the wires routed at right angles, each on a track of its own. Pure: an
// answer in, geometry out; `measure(text, px)` gives a title's width at a size.

import { route } from './route.js';

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
/**
 * `prior`, when given, is the `memo` of the layout before this one (the same system a step earlier). Staying put is
 * then the default: places keep their order, parts their row and their place across, and only what is new, or what a
 * new wire forces, moves.
 *
 * `steady` lays out a picture of steps (it is set whenever there is a prior): places that only call one way are
 * stacked, wires turn as little as they can, and no two drops run side by side. Without it, a picture is laid out as
 * it always was.
 */
export function layout({ items, links, rootId, measure, sizes, prior, steady = Boolean(prior), room }) {
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

  // ---- Wires: a calls b when a link goes from a to b (a depends on b, needs it, sends to it). One a pair: a link
  // back the other way makes it a wire both ways (both).
  let edges = [];
  const seen = new Map();
  for (const l of links) {
    if (!nodes.has(l.from) || !nodes.has(l.to) || l.from === l.to) continue;
    const key = [l.from, l.to].sort().join(' ');
    if (seen.has(key)) {
      if (seen.get(key).a !== l.from) seen.get(key).both = true;
      continue;
    }
    seen.set(key, { a: l.from, b: l.to, link: l, ...(l.says && { says: l.says }), state: wireState(l, nodes.get(l.from).item, nodes.get(l.to).item) });
    edges.push(seen.get(key));
  }
  // A loop is drawn with one wire turned back, so the rest still reads down the page. Where it comes back to whoever
  // uses the system (a client, a person), it is turned back there: they stay at the top and the rest falls from them.
  const user = (id) => {
    const i = nodes.get(id).item;
    return ['client', 'person', 'user'].includes(i.role ?? i.fields?.role) || i.kind === 'actor';
  };
  const leads = (from, to) => {
    const been = new Set([from]), next = [from];
    while (next.length) {
      const id = next.pop();
      if (id === to) return true;
      for (const e of edges) if (e.a === id && !e.both && !been.has(e.b)) (been.add(e.b), next.push(e.b));
    }
    return false;
  };
  for (const e of edges) if (!e.both && user(e.b) && !user(e.a) && leads(e.b, e.a)) ([e.a, e.b] = [e.b, e.a]), (e.back = true);
  // Any other loop is turned back where it is first met. A wire both ways is no loop: it is laid out afterwards, in
  // whichever way closes none.
  const colour = new Map();
  const visit = (id) => {
    colour.set(id, 1);
    for (const e of edges.filter((f) => f.a === id && !f.both)) {
      if (colour.get(e.b) === 1) ([e.a, e.b] = [e.b, e.a]), (e.back = true);
      else if (!colour.get(e.b)) visit(e.b);
    }
    colour.set(id, 2);
  };
  for (const id of nodes.keys()) if (!colour.get(id)) visit(id);
  const laid = new Set(edges.filter((e) => !e.both));
  const reaches = (from, to) => {
    const been = new Set([from]), next = [from];
    while (next.length) {
      const id = next.pop();
      if (id === to) return true;
      for (const e of laid) if (e.a === id && !been.has(e.b)) (been.add(e.b), next.push(e.b));
    }
    return false;
  };
  for (const e of edges.filter((f) => f.both)) {
    if (reaches(e.b, e.a)) [e.a, e.b] = [e.b, e.a];
    laid.add(e);
  }

  // ---- Places stacked. A place whose parts call into one other place, and are never called from it, sits wholly
  // above it and shares its span across: for the layout its parts are in that place's column (col), and each row of
  // theirs is above every row of the place below. Each is still drawn in a box of its own (home).
  for (const n of nodes.values()) n.home = n.col;
  const homes = steady ? [...new Set([...nodes.values()].map((n) => n.col).filter(Boolean))] : [];
  const callsInto = (p, q) => edges.some((e) => nodes.get(e.a).col === p && nodes.get(e.b).col === q);
  const onto = new Map();
  for (const p of homes) {
    const below = homes.filter((q) => q !== p && callsInto(p, q) && !callsInto(q, p));
    if (below.length === 1) onto.set(p, below[0]);
  }
  const base = (c) => { let k = c; for (let i = 0; i < 8 && onto.has(k); i++) k = onto.get(k); return k; };
  // Rows only: every part of an upper place counts as calling every part of the place it sits on.
  const stackOut = new Map(), stackIn = new Map();
  for (const [p, q] of onto)
    for (const a of [...nodes.values()].filter((n) => n.home === p))
      for (const b of [...nodes.values()].filter((n) => n.home === q)) {
        (stackOut.get(a.id) ?? stackOut.set(a.id, []).get(a.id)).push(b.id);
        (stackIn.get(b.id) ?? stackIn.set(b.id, []).get(b.id)).push(a.id);
      }
  for (const n of nodes.values()) n.col = n.col === null ? null : base(n.col);

  // ---- Sizes.
  for (const n of nodes.values()) {
    // Beside its name, the room a part is given for more (a story's flag on it), by id.
    const text = Math.min(measure(n.item.title, TEXT), MAX_TEXT) + (room?.get(n.id) ?? 0);
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H];
    else if (n.shape === 'store') [n.w, n.h] = [text + STORE_PAD, STORE_H];
    else [n.w, n.h] = [text + BOX_PAD, BOX_H];
  }

  // ---- Layers, from the bottom up: what calls nothing (a store, a model, a service outside) on the last row, and
  // each part one above the highest it calls, so a part sits just above what it sends to.
  const outs = (id) => [...edges.filter((e) => e.a === id).map((e) => e.b), ...(stackOut.get(id) ?? [])];
  const rises = new Map();
  const rise = (id) => {
    if (!rises.has(id)) rises.set(id, Math.max(0, ...outs(id).map((b) => rise(b) + 1)));
    return rises.get(id);
  };
  for (const id of nodes.keys()) rise(id);
  const tallest = Math.max(...rises.values());
  const layerOf = new Map([...rises].map(([id, k]) => [id, tallest - k]));
  // With a prior, a part keeps its row. A new part goes just above what it calls, or else just below what calls it.
  // Where a new wire needs a part higher than what it calls, either the callers are lifted or the called pushed
  // down: both are tried, and the one with fewer rows wins, then the one that moves fewer parts.
  if (prior) {
    const ins = (id) => [...edges.filter((e) => e.b === id).map((e) => e.a), ...(stackIn.get(id) ?? [])];
    const topo = [], done = new Set();
    const walk = (id) => { if (done.has(id)) return; done.add(id); ins(id).forEach(walk); topo.push(id); };
    for (const id of nodes.keys()) walk(id);
    const pushDown = (L) => { for (const id of topo) L.set(id, Math.max(L.get(id), ...ins(id).map((a) => L.get(a) + 1))); return L; };
    const liftUp = (L) => { for (const id of [...topo].reverse()) if (outs(id).length) L.set(id, Math.max(0, Math.min(L.get(id), ...outs(id).map((b) => L.get(b) - 1)))); return L; };
    const was = (id) => prior.layerOf.get(id);
    const start = new Map([...nodes.keys()].map((id) => [id, was(id)]));
    for (const id of nodes.keys()) {
      if (start.get(id) !== undefined) continue;
      const below = outs(id).map(was).filter((k) => k !== undefined), above = ins(id).map(was).filter((k) => k !== undefined);
      start.set(id, below.length ? Math.max(0, Math.min(...below) - 1) : above.length ? Math.max(...above) + 1 : 0);
    }
    const closeUp = (L) => { const used = [...new Set(L.values())].sort((p, q) => p - q); for (const [id, k] of L) L.set(id, used.indexOf(k)); return L; };
    const rows = (L) => new Set(L.values()).size;
    const moves = (L) => [...L].filter(([id, k]) => was(id) !== undefined && was(id) !== k).length;
    const pick = [pushDown(new Map(start)), pushDown(liftUp(new Map(start)))].map(closeUp).reduce((a, b) => (rows(b) < rows(a) || (rows(b) === rows(a) && moves(b) < moves(a)) ? b : a));
    for (const [id, k] of pick) layerOf.set(id, k);
  }
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
  // With a prior, the places keep the order they had; a new one goes where it makes the wires between places shortest.
  if (prior) {
    const cost = (list) => { const at = new Map(list.map((c, k) => [c, k])); return across.reduce((s, [p1, q1]) => s + Math.abs(at.get(p1) - at.get(q1)), 0); };
    order = cols.filter((c) => prior.order.includes(c)).sort((p, q) => prior.order.indexOf(p) - prior.order.indexOf(q));
    for (const c of cols.filter((c) => !prior.order.includes(c))) {
      const tries = order.map((_, k) => [...order.slice(0, k), c, ...order.slice(k)]).concat([[...order, c]]);
      order = tries.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    }
    if (order.includes(null)) order = [null, ...order.filter((c) => c !== null)];
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
  // With a prior, each row starts in the order it had across the page; what is new goes in at the middle of what it is
  // wired to; a sweep's reordering is kept only if it saves at least SAVES crossings, so a part is not moved for little.
  const SAVES = 2;
  if (prior) {
    const was = (id) => prior.x.get(id);
    // A waypoint stands for the two parts its wire joins.
    const real = (v) => { if (!nodes.get(v).dummy) return [v]; const c = chains.find((c) => c.path.includes(v)); return [c.a, c.b]; };
    const near = (id) => (nodes.get(id).dummy ? real(id) : [...up.get(id), ...down.get(id)].flatMap(real));
    const key = (id) => {
      if (was(id) !== undefined) return was(id);
      const xs = near(id).map(was).filter((v) => v !== undefined);
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length + 0.5 : Infinity;
    };
    layers.forEach((list) => byColumn(list, key));
    index();
  }
  let best = layers.map((l) => [...l]), fewest = crossings();
  const kept = fewest;
  for (let round = 0; round < 16 && fewest > 0; round++) {
    if (round % 2 === 0) for (let k = 1; k < layers.length; k++) sweep(k, up);
    else for (let k = layers.length - 2; k >= 0; k--) sweep(k, down);
    const count = crossings();
    if (count < fewest && (!prior || count <= kept - SAVES)) ((fewest = count), (best = layers.map((l) => [...l])));
  }
  layers.splice(0, layers.length, ...best);
  index();

  // ---- Places across: each column as wide as its widest layer, then each part pulled toward what it is wired to.
  const gap = (a, b) => (nodes.get(a).dummy || nodes.get(b).dummy ? NODE_GAP / 2 : NODE_GAP);
  const cell = (k, c) => layers[k].filter((id) => nodes.get(id).col === c);
  const widthOf = (ids) => ids.reduce((s, id, k) => s + nodes.get(id).w + (k ? gap(ids[k - 1], id) : 0), 0);
  const colLeft = new Map(), colRight = new Map();
  const colWidth = (c) => Math.max(...layers.map((_, k) => widthOf(cell(k, c))), c === null ? 0 : measure(byId.get(c).title, PLACE_TEXT) + PLACE_NAME_PAD);
  const between = COL_GAP + 2 * PAD;
  if (!prior) {
    let at = MARGIN + PAD;
    for (const c of order) {
      const w = colWidth(c);
      colLeft.set(c, at);
      colRight.set(c, at + w);
      at += w + between;
    }
  } else {
    // With a prior, the place that holds the most stays where it was; the others keep their edge toward it and grow
    // away from it, so a place that widens pushes nothing back across the page. The picture may then start left of 0.
    const holds = (c) => [...nodes.values()].filter((n) => !n.dummy && n.col === c).length;
    const known = order.filter((c) => prior.colLeft.has(c));
    const anchor = known.length ? known.reduce((a, c) => (holds(c) > holds(a) ? c : a)) : order[0];
    const ai = order.indexOf(anchor);
    const aLeft = prior.colLeft.get(anchor) ?? MARGIN + PAD;
    colLeft.set(anchor, aLeft);
    colRight.set(anchor, aLeft + colWidth(anchor));
    for (let k = ai + 1; k < order.length; k++) {
      const c = order[k], left = colRight.get(order[k - 1]) + between;
      colLeft.set(c, left);
      colRight.set(c, left + colWidth(c));
    }
    for (let k = ai - 1; k >= 0; k--) {
      const c = order[k], right = colLeft.get(order[k + 1]) - between;
      colRight.set(c, right);
      colLeft.set(c, right - colWidth(c));
    }
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
  // With a prior, a part wants the place it had in its column; only what is new is pulled toward what it is wired to.
  if (prior) {
    for (let round = 0; round < 6; round++)
      for (let k = 0; k < layers.length; k++)
        for (const c of order) {
          const ids = cell(k, c);
          if (!ids.length) continue;
          settle(ids, new Map(ids.map((id) => {
            if (prior.offset.has(id)) return [id, colLeft.get(c) + prior.offset.get(id)];
            const nb = [...up.get(id), ...down.get(id)];
            return [id, nb.length ? nb.reduce((s, n) => s + x.get(n), 0) / nb.length : x.get(id)];
          })));
        }
  } else
    for (let round = 0; round < 6; round++) {
      for (let k = 1; k < layers.length; k++) pull(k, up);
      for (let k = layers.length - 2; k >= 0; k--) pull(k, down);
    }

  // Fewer turns, first (steady): a long wire's waypoints all take one x within reach of a port of one of its ends, where every
  // waypoint fits there between its neighbours in its row; the wire then drops straight past those rows. An x within
  // reach of both ends is best (no turn at all), then the one nearest an end's middle.
  const gapTo = (a, b) => (nodes.get(a).w + nodes.get(b).w) / 2 + gap(a, b);
  for (const c of steady ? chains : []) {
    const ways = c.path.slice(1, -1);
    if (!ways.length) continue;
    const fits = (t) => ways.every((d) => {
      const row = layers[nodes.get(d).layer], k = row.indexOf(d);
      return (k === 0 || t >= x.get(row[k - 1]) + gapTo(row[k - 1], d)) && (k === row.length - 1 || t <= x.get(row[k + 1]) - gapTo(d, row[k + 1]));
    });
    const reach = (id) => { const n = nodes.get(id), half = n.w * (n.shape === 'diamond' ? 0.12 : 0.4); return [x.get(id) - half, x.get(id) + half]; };
    const [a1, a2] = reach(c.a), [b1, b2] = reach(c.b);
    // A wire that was there the step before keeps its line, where it still fits and still runs between its ends: staying
    // put is the default, but not out past both ends and back, once they have moved away from it.
    const fitsAt = (d, t) => { const row = layers[nodes.get(d).layer], k = row.indexOf(d); return (k === 0 || t >= x.get(row[k - 1]) + gapTo(row[k - 1], d)) && (k === row.length - 1 || t <= x.get(row[k + 1]) - gapTo(d, row[k + 1])); };
    const between = (t) => t >= Math.min(a1, b1) && t <= Math.max(a2, b2);
    if (prior && ways.every((d) => prior.x.has(d) && fitsAt(d, prior.x.get(d)) && between(prior.x.get(d)))) {
      for (const d of ways) x.set(d, prior.x.get(d));
      continue;
    }
    const tries = [];
    for (let t = Math.min(a1, b1); t <= Math.max(a2, b2); t += 2) {
      const inA = t >= a1 && t <= a2, inB = t >= b1 && t <= b2;
      if (inA || inB) tries.push([t, (inA && inB ? 0 : 1000) + Math.min(Math.abs(t - x.get(c.a)), Math.abs(t - x.get(c.b)))]);
    }
    const t = tries.sort((p, q) => p[1] - q[1]).map(([v]) => v).find(fits);
    if (t !== undefined) for (const d of ways) x.set(d, t);
  }

  const { all, boxes, breaks, y, width, height, left, rooms } = route({ nodes, chains, layers, x, byId, order, colLeft, colRight, measure, prior, steady, health, sizes: { SLOT, TRACK, LAYER_GAP, PAD, LEAD_OUT, LEAD_IN, HEAD, MARGIN, PLACE_TEXT, PLACE_NAME_PAD } });
  // What the next step's layout is handed as its prior.
  const parts = [...nodes.values()].filter((n) => !n.dummy);
  // Where each part and each waypoint was across: a waypoint keeps its name while its wire and rows stay, so a step
  // that changes nothing lays out as it was.
  const placed = [...nodes.values()];
  const memo = { order, colLeft, colRight, rooms, layerOf: new Map(parts.map((n) => [n.id, n.layer])), x: new Map(placed.map((n) => [n.id, x.get(n.id)])), offset: new Map(placed.map((n) => [n.id, x.get(n.id) - colLeft.get(n.col)])) };
  // `left` is where the picture starts across: 0 but for a steady picture whose place has grown leftward.
  return { nodes, all, groups, boxes, chains, breaks, x, y, left, width, height, memo };
}
