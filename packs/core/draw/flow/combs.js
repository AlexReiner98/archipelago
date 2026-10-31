// What hangs off the knot. Peeling what has one neighbour leaves the knot and a tree on each of its items; a tree is drawn
// as a comb, spines of rows either side, which cannot cross itself. Pure: lengths in, places and wires out, each wire the
// points of one link from what holds it down to the item, in the comb's own frame.

/** How many levels a tree may hang: a chain longer than this reads better down the rows than folded into a comb. */
const DEEPEST = 12;

/** Peel what has one neighbour: `kids` of each item, and the core left. What is in `stay` is never peeled. */
export function peel(a, stay = new Set(), holds = () => false) {
  const degree = new Map([...a].map(([k, s]) => [k, s.size])), kids = new Map(), gone = new Set(), levels = new Map();
  const todo = [...a.keys()].filter((k) => degree.get(k) === 1 && !stay.has(k));
  while (todo.length) {
    let n = todo.pop();
    if (gone.has(n) || degree.get(n) !== 1) continue;
    let p = [...a.get(n)].find((w) => !gone.has(w));
    // Of the last two, what holds more stays.
    if (degree.get(p) === 1 && !stay.has(p) && (kids.get(n)?.length ?? 0) > (kids.get(p)?.length ?? 0)) [n, p] = [p, n];
    if (holds(n, p) || (levels.get(n) ?? 0) >= DEEPEST) continue;
    gone.add(n);
    levels.set(p, Math.max(levels.get(p) ?? 0, (levels.get(n) ?? 0) + 1));
    (kids.get(p) ?? kids.set(p, []).get(p)).push(n);
    degree.set(p, degree.get(p) - 1);
    if (degree.get(p) === 1 && !stay.has(p)) todo.push(p);
  }
  return { kids, core: [...a.keys()].filter((k) => !gone.has(k)) };
}

/**
 * The tree on `n` as a comb hanging from (0, 0): `items` with their middles, `wires` by item, each from the holder's edge
 * to the item's, and its width and height. `size(id)` is a box's size, `z` the row and column gaps. `sideOf(p, k)` is the
 * way the order has `k` from its holder `p`, 1 below it, -1 above it, 0 no way of its own, and a comb hangs only what
 * belongs on `way`, what has no way of its own going `rest`. A comb on -1 is drawn in a frame the caller turns over.
 * With `level` its bus runs level with (0, 0), for a comb that hangs beside its holder and not under it: a wire leaves the
 * holder straight along the bus. With `near`, every kid has a spine down the side that faces the holder, so a wire reaches
 * it by its near side. With `alone`, one kid with nothing under it sits straight on from the holder. With `drop`, the comb
 * hangs from a port in the holder's foot: its first spine runs straight down from (0, 0), and one kid alone stands
 * directly under the holder, whose left edge is `pad` to the left, `z.join` below it. A near comb's own kids hang so.
 * `aspect` is the shape to fold its kids into. Each wire is a track of its own in the solve, which reads their order off
 * the picture: so each stands a hair apart here, the deepest kid's on the lowest bus and the first spine, and none can cross.
 */
export function comb(n, kids, size, z, sideOf = () => 1, way = 1, rest = way, { level = false, near = false, alone = false, drop = false, pad = 0, wide = 0, aspect = 1.25 } = {}) {
  const under = (kids.get(n) ?? []).filter((id) => (sideOf(n, id) || rest) === way).map((id) => {
    const s = size(id), port = near ? Math.min(s.w / 4, z.stub ?? z.col / 2) : 0, how = { near, drop: near, pad: port, wide: s.w - port, aspect };
    const b = comb(id, kids, size, z, sideOf, way, way, how), back = comb(id, kids, size, z, sideOf, -way, way, how);
    const lead = back.items.length ? back.h + z.row : 0;
    return { id, b, back, lead, s, port, w: Math.max(s.w, port + b.w, port + back.w), h: lead + s.h + (b.items.length ? z.row + b.h : 0) + z.row };
  }).sort((p, q) => q.h * q.w - p.h * p.w);
  if (!under.length) return { items: [], wires: new Map(), w: 0, h: 0 };
  if (alone && under.length === 1 && !under[0].b.items.length && !under[0].back.items.length) {
    const [c] = under;
    return { items: [{ id: c.id, x: 0, y: 0 }], wires: new Map([[c.id, [[-c.s.w / 2, 0]]]]), w: c.s.w, h: c.s.h / 2, above: c.s.h / 2 };
  }
  if (drop && under.length === 1 && !under[0].b.items.length && !under[0].back.items.length) {
    const [c] = under, reach = Math.max(z.join ?? z.row, z.row);
    return { items: [{ id: c.id, x: c.s.w / 2 - pad, y: reach + c.s.h / 2 }], wires: new Map([[c.id, [[0, 0], [0, reach]]]]), w: c.s.w - pad, h: reach + c.s.h };
  }
  const area = under.reduce((s, c) => s + (c.w + z.col) * c.h, 0), tall = Math.max(under[0].h, Math.sqrt(area / aspect));
  const spines = [], stub = z.stub ?? z.col / 2;
  for (const c of under) {
    let at = spines.find((p) => (near ? p.rh : Math.min(p.lh, p.rh)) + c.h <= tall);
    if (!at) spines.push((at = { left: [], right: [], lh: 0, rh: 0 }));
    const left = !near && at.lh <= at.rh;
    at[left ? 'left' : 'right'].push(c);
    at[left ? 'lh' : 'rh'] += c.h;
  }
  let run = 0;
  for (const p of spines) {
    const lw = Math.max(0, ...p.left.map((c) => c.w)), rw = Math.max(0, ...p.right.map((c) => c.w));
    p.x = run + lw + z.col / 2;
    run += lw + z.col / 2 + stub + rw + z.col;
  }
  const centre = drop ? spines[0].x : (run - z.col) / 2, bus = level ? 0 : z.row + 6, items = [], wires = new Map();
  const nested = spines.flatMap((p) => [...p.left, ...p.right].reverse()), hair = (c) => nested.indexOf(c) / (nested.length + 1), lift = (c) => 1 - (nested.indexOf(c) + 2) / (nested.length + 1);
  // One column alone: its first kid stands level with the holder, and the wire runs straight to it.
  const first = alone && spines.length === 1 && !under[0].lead ? under[0] : null;
  let bottom = 0;
  for (const p of spines) {
    const sx = p.x - centre;
    for (const [list, sign] of [[p.left, -1], [p.right, 1]]) {
      let y = first ? -first.s.h / 2 : drop ? Math.max(z.join ?? z.row, z.row) : bus + z.row;
      for (const c of list) {
        const cy = y + c.lead + c.s.h / 2, cx = sx + sign * (stub + c.s.w / 2);
        items.push({ id: c.id, x: cx, y: cy });
        const [across, along] = [hair(c), bus + lift(c)], onward = sx === 0 && drop ? [[across, 0], [across, cy]] : [...(level ? [[0, along]] : [[across, 0], [across, along]]), [sx + across, along], [sx + across, cy]];
        // The first under a holder it stands below takes a wire of its own, straight down.
        const under1 = spines.length === 1 && drop && c === list[0] && !c.lead ? stub + Math.min(c.s.w / 4, stub) : Infinity;
        wires.set(c.id, c === first ? [[cx - (sign * c.s.w) / 2, 0]] : under1 < wide ? [[under1, 0], [under1, y]] : [...onward, [cx - (sign * c.s.w) / 2, cy]]);
        const dx = near ? sx + stub + c.port : sx + sign * (stub + c.w / 2);
        const hangs = (from, top, turn, tree) => {
          const move = ([px, py]) => [px + dx, top + turn * py];
          for (const it of tree.items) items.push({ id: it.id, x: it.x + dx, y: top + turn * it.y });
          for (const [id, points] of tree.wires) wires.set(id, points[0][0] === 0 && points[0][1] === 0 && !near ? [[cx, from], [cx, top], ...points.map(move)] : points.map(move));
        };
        // A near comb's hang from the holder's own edge.
        const shy = near ? 0 : z.row / 2;
        if (c.b.items.length) hangs(cy + c.s.h / 2, y + c.lead + c.s.h + shy, 1, c.b);
        if (c.back.items.length) hangs(cy - c.s.h / 2, y + c.lead - shy, -1, c.back);
        y += c.h;
      }
      bottom = Math.max(bottom, y);
    }
  }
  return { items, wires, w: run - z.col - (drop ? z.col / 2 : 0), h: bottom, ...(first && { above: first.s.h / 2 }) };
}
