// Where everything sits on the canvas, apart from how it looks (index.js). What holds others is a region with what it
// holds inside it, so the closure of part_of is drawn as land within land; inside each region, things that depend on
// each other are laid out in rows, what is depended on above what depends on it, as a flow reads; things tied by
// nothing are packed into rows to the region's shape. Every link between two things drawn is a wire from one edge to
// the other. Pure: an answer in, geometry out; `measure(text, px)` gives a title's width at a size.

import { outlineOf, REGIONS, roomOf } from './outlines.js';

/** The links a row order follows: what is depended on comes before what depends on it. */
const FLOW = new Set(['depends_on']);
/** The links that point at the one that waits: drawn from what it waits on to it. */
const TOWARD = new Set(['depends_on', 'waits_on', 'needs']);

/**
 * Every node (its place x, y from the top left, size w, h, outline and whether it is a region), every wire (its path,
 * where it ends and which way it points there) and the whole size. Every length is the style's (`sizes`, space_*):
 * the canvas pack's preset names each, and a nearer style may change any.
 */
export function layout({ items, links, measure, sizes, numbers, outlines }) {
  const need = (set, name) => {
    if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the canvas pack's preset names every one the canvas lays out by`);
    return set[name];
  };
  const [TEXT, HEAD_TEXT, BOX, TEXT_X, TEXT_AFTER, MAX_TEXT, PAD, HEAD, GAP, LAYER_GAP, MARGIN, REACH, BADGE] = ['text', 'head_text', 'box', 'text_x', 'text_after', 'max_text', 'pad', 'head', 'gap', 'layer_gap', 'margin', 'reach', 'badge'].map((n) => need(sizes, `space_${n}`));
  const ASPECT = need(numbers, 'space_aspect');

  // ---- The tree: each thing under what holds it, when that was sent.
  const nodes = new Map(items.map((item) => [item.id, { id: item.id, item, kids: [], up: null }]));
  const roots = [];
  for (const n of nodes.values()) {
    const up = nodes.get(n.item.inside);
    if (up && up !== n) (up.kids.push(n), (n.up = up));
    else roots.push(n);
  }
  const byPlace = (a, b) => (a.item.place ?? 0) - (b.item.place ?? 0);
  roots.sort(byPlace);
  for (const n of nodes.values()) n.kids.sort(byPlace);
  const depthOf = (n) => (n.up ? depthOf(n.up) + 1 : 0);

  // ---- Each thing's size: a node fits its title in its outline; a region fits what it holds under its head.
  const fit = (text, px) => Math.min(measure(text, px), MAX_TEXT);
  const sizeLeaf = (n) => {
    n.outline = outlineOf(n.item, outlines);
    const room = roomOf(n.outline, BOX);
    // What it holds and was not sent is a count on its corner.
    n.hidden = n.item.within?.items ?? 0;
    n.w = room.left + TEXT_X + fit(n.item.title, TEXT) + TEXT_AFTER + room.right + (n.hidden ? BADGE : 0);
    n.h = room.h;
    n.room = room;
  };
  /** Things beside each other, placed in rows: by what depends on what where something does, else packed to the aspect. */
  const arrange = (kids, holder) => {
    const at = new Map(kids.map((k) => [k.id, k]));
    // Which of these holds an item, at any depth: a link between two things inside is a link between them.
    const childOf = (id) => {
      for (let n = nodes.get(id); n; n = n.up) if (n.up === holder && at.has(n.id)) return n;
      return holder === null ? roots.find((r) => r.id === id) : undefined;
    };
    const before = new Map(kids.map((k) => [k.id, new Set()]));
    for (const l of links) {
      if (!FLOW.has(l.kind)) continue;
      const [a, b] = [childOf(l.to), childOf(l.from)];
      if (a && b && a !== b) before.get(b.id).add(a.id);
    }
    const tied = [...before.values()].some((s) => s.size);
    // About as wide as the region is to be: the widest thing, or its area laid out to the style's aspect.
    const area = kids.reduce((s, k) => s + (k.w + GAP) * (k.h + GAP), 0);
    const most = Math.max(...kids.map((k) => k.w), Math.sqrt(area * ASPECT));
    /** A row cut into rows no wider than the region is to be. */
    const wrap = (row) => {
      const out = [];
      let cur = [], width = 0;
      for (const k of row) {
        if (cur.length && width + GAP + k.w > most) (out.push(cur), (cur = []), (width = 0));
        width += (cur.length ? GAP : 0) + k.w;
        cur.push(k);
      }
      if (cur.length) out.push(cur);
      return out;
    };
    let rows = [];
    if (tied) {
      // Layers by the longest path down to each, a loop cut where it closes.
      const layer = new Map();
      const deep = (id, trail) => {
        if (layer.has(id)) return layer.get(id);
        if (trail.has(id)) return 0;
        trail.add(id);
        const d = Math.max(-1, ...[...before.get(id)].map((p) => deep(p, trail))) + 1;
        trail.delete(id);
        layer.set(id, d);
        return d;
      };
      for (const k of kids) deep(k.id, new Set());
      for (const k of kids) (rows[layer.get(k.id)] ??= []).push(k);
      // Each row ordered by where what it follows sits in the rows above: fewer wires cross.
      const index = new Map();
      for (const row of rows.filter(Boolean)) {
        const bary = (k) => {
          const ps = [...before.get(k.id)].filter((p) => index.has(p));
          return ps.length ? ps.reduce((s, p) => s + index.get(p), 0) / ps.length : Infinity;
        };
        row.sort((a, b) => bary(a) - bary(b) || byPlace(a, b));
        row.forEach((k, i) => index.set(k.id, i / Math.max(1, row.length - 1)));
      }
      // A layer too wide for the region goes on in a row under it, before the next layer.
      rows = rows.filter(Boolean).flatMap(wrap);
    } else rows = wrap(kids);
    const kept = rows.filter((r) => r?.length);
    const widths = kept.map((r) => r.reduce((s, k) => s + k.w, 0) + GAP * (r.length - 1));
    const width = Math.max(0, ...widths);
    let y = 0;
    kept.forEach((r, i) => {
      const tall = Math.max(...r.map((k) => k.h));
      let x = (width - widths[i]) / 2;
      for (const k of r) ((k.rx = x), (k.ry = y + (tall - k.h) / 2), (x += k.w + GAP));
      y += tall + (tied ? LAYER_GAP : GAP);
    });
    return { width, height: Math.max(0, y - (tied ? LAYER_GAP : GAP)) };
  };
  const size = (n) => {
    if (!n.kids.length) return sizeLeaf(n);
    for (const k of n.kids) size(k);
    n.region = true;
    const named = outlineOf(n.item, outlines);
    n.outline = REGIONS.includes(named) ? named : 'round';
    const room = roomOf(n.outline, HEAD);
    const inner = arrange(n.kids, n);
    n.head = Math.max(HEAD, room.h);
    n.w = Math.max(inner.width + 2 * PAD, fit(n.item.title, HEAD_TEXT) + 2 * PAD + BADGE * 3);
    n.h = n.head + inner.height + PAD;
    n.inner = inner;
  };
  for (const r of roots) size(r);
  const whole = arrange(roots, null);

  // ---- Where each sits on the canvas.
  const place = (n, x, y) => {
    n.x = x;
    n.y = y;
    n.depth = depthOf(n);
    if (n.region) for (const k of n.kids) place(k, x + (n.w - n.inner.width) / 2 + k.rx, y + n.head + k.ry);
  };
  for (const r of roots) place(r, MARGIN + r.rx, MARGIN + r.ry);

  // ---- Wires: from one edge to the other, leaving and arriving square to the edge, bent as a flow's are.
  const holds = (a, b) => {
    for (let n = b.up; n; n = n.up) if (n === a) return true;
    return false;
  };
  const wires = [];
  for (const l of links) {
    const [src, dst] = TOWARD.has(l.kind) ? [nodes.get(l.to), nodes.get(l.from)] : [nodes.get(l.from), nodes.get(l.to)];
    if (!src || !dst || src === dst || holds(src, dst) || holds(dst, src)) continue;
    // A region's wire leaves from under its head, where its name is.
    const box = (n) => (n.region ? { l: n.x, t: n.y, r: n.x + n.w, b: n.y + n.head, cx: n.x + n.w / 2, cy: n.y + n.head / 2 } : { l: n.x, t: n.y, r: n.x + n.w, b: n.y + n.h, cx: n.x + n.w / 2, cy: n.y + n.h / 2 });
    const [a, b] = [box(src), box(dst)];
    const below = b.t >= a.b, above = b.b <= a.t;
    let s, e, ds, de;
    if (below || above) {
      s = [a.cx, below ? a.b : a.t];
      e = [b.cx, below ? b.t : b.b];
      ds = [0, below ? 1 : -1];
      de = [0, below ? -1 : 1];
    } else {
      const right = b.cx >= a.cx;
      s = [right ? a.r : a.l, a.cy];
      e = [right ? b.l : b.r, b.cy];
      ds = [right ? 1 : -1, 0];
      de = [right ? -1 : 1, 0];
    }
    const reach = Math.max(REACH, Math.hypot(e[0] - s[0], e[1] - s[1]) / 3);
    const c1 = [s[0] + ds[0] * reach, s[1] + ds[1] * reach], c2 = [e[0] + de[0] * reach, e[1] + de[1] * reach];
    const r = (v) => Math.round(v * 10) / 10;
    wires.push({ kind: l.kind, n: l.n ?? 1, from: src.id, to: dst.id, says: l.says, state: l.state, d: `M${r(s[0])} ${r(s[1])}C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(e[0])} ${r(e[1])}`, end: e, toward: [-de[0], -de[1]], arrow: TOWARD.has(l.kind) });
  }
  return { nodes, roots, wires, width: whole.width + 2 * MARGIN, height: whole.height + 2 * MARGIN };
}
