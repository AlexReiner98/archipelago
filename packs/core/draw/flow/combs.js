// What hangs off the knot. Peeling what has one neighbour leaves the knot and a tree on each of its items; a tree is drawn
// as a comb, spines of rows either side, which cannot cross itself. Items joined to the same two and nothing else are
// one block between those two, on two rails that interleave. Pure: lengths in, places and wires out, each wire the
// points of one link from what holds it down to the item, in the comb's own frame.

/** Peel what has one neighbour: `kids` of each item, and the core left. */
export function peel(a) {
  const degree = new Map([...a].map(([k, s]) => [k, s.size])), kids = new Map(), gone = new Set();
  const todo = [...a.keys()].filter((k) => degree.get(k) === 1);
  while (todo.length) {
    const n = todo.pop();
    if (gone.has(n) || degree.get(n) !== 1) continue;
    const p = [...a.get(n)].find((w) => !gone.has(w));
    gone.add(n);
    (kids.get(p) ?? kids.set(p, []).get(p)).push(n);
    degree.set(p, degree.get(p) - 1);
    if (degree.get(p) === 1) todo.push(p);
  }
  return { kids, core: [...a.keys()].filter((k) => !gone.has(k)) };
}

/**
 * The tree under `n` as a comb hanging from (0, 0): `items` with their middles, `wires` by item, each from the holder's
 * edge to the item's, and its width and height. `size(id)` is a box's size, `z` the row and column gaps.
 */
export function comb(n, kids, size, z) {
  const under = (kids.get(n) ?? []).map((id) => {
    const b = comb(id, kids, size, z), s = size(id);
    return { id, b, s, w: Math.max(s.w, b.w), h: s.h + (b.items.length ? z.row + b.h : 0) + z.row };
  }).sort((p, q) => q.h * q.w - p.h * p.w);
  if (!under.length) return { items: [], wires: new Map(), w: 0, h: 0 };
  const area = under.reduce((s, c) => s + (c.w + z.col) * c.h, 0), tall = Math.max(under[0].h, Math.sqrt(area * 0.8));
  const spines = [];
  for (const c of under) {
    let at = spines.find((p) => Math.min(p.lh, p.rh) + c.h <= tall);
    if (!at) spines.push((at = { left: [], right: [], lh: 0, rh: 0 }));
    const left = at.lh <= at.rh;
    at[left ? 'left' : 'right'].push(c);
    at[left ? 'lh' : 'rh'] += c.h;
  }
  let run = 0;
  for (const p of spines) {
    const lw = Math.max(0, ...p.left.map((c) => c.w)), rw = Math.max(0, ...p.right.map((c) => c.w));
    p.x = run + lw + z.col / 2;
    run += lw + z.col + rw + z.col;
  }
  const centre = (spines[0].x + spines.at(-1).x) / 2, bus = z.row + 6, items = [], wires = new Map();
  let bottom = 0;
  for (const p of spines) {
    const sx = p.x - centre;
    for (const [list, sign] of [[p.left, -1], [p.right, 1]]) {
      let y = bus + z.row;
      for (const c of list) {
        const cy = y + c.s.h / 2, cx = sx + sign * (z.col / 2 + c.s.w / 2);
        items.push({ id: c.id, x: cx, y: cy });
        wires.set(c.id, [[0, 0], [0, bus], [sx, bus], [sx, cy], [cx - (sign * c.s.w) / 2, cy]]);
        if (c.b.items.length) {
          const dx = sx + sign * (z.col / 2 + c.w / 2), top = y + c.s.h + z.row / 2, down = c.b;
          const move = ([px, py]) => [px + dx, py + top];
          for (const it of down.items) items.push({ id: it.id, x: it.x + dx, y: it.y + top });
          for (const [id, points] of down.wires) wires.set(id, [[cx, cy + c.s.h / 2], ...points.map(move)]);
        }
        y += c.h;
      }
      bottom = Math.max(bottom, y);
    }
  }
  return { items, wires, w: run - z.col, h: bottom };
}

/** Items of the core joined to the same two and nothing else, three or more: each such set one block, by the id it gets. */
export function twins(a, kids, core, size, z) {
  const inCore = new Set(core), sets = new Map(), blocks = new Map();
  for (const id of core) {
    if (kids.has(id)) continue;
    const near = [...a.get(id)].filter((w) => inCore.has(w));
    if (near.length !== 2) continue;
    const key = near.sort().join(' ');
    (sets.get(key) ?? sets.set(key, []).get(key)).push(id);
  }
  for (const [key, list] of sets) {
    if (list.length < 3) continue;
    const [u, v] = key.split(' '), n = list.length, k = Math.ceil(Math.sqrt(n / 3)), rows = Math.ceil(n / k);
    const cw = Math.max(...list.map((id) => size(id).w)), ch = Math.max(...list.map((id) => size(id).h)) + z.row;
    blocks.set(`block:${key}`, { u, v, list, k, cw, ch, w: k * cw + (k + 1) * z.col, h: rows * ch + 2 * z.col });
  }
  return blocks;
}

/**
 * A block's items around its middle (x, y): `places` by item, and each item's two wires, `first` from the rail along its
 * head, entered at its left corner, and `second` from the rail along its foot, entered at its right. Buses from the two
 * rails take turns between the columns, so no wire of it crosses another of it.
 */
export function drawBlock(b, x, y, size, z) {
  const left = x - b.w / 2, top = y - b.h / 2, railA = top + z.col / 2, railB = top + b.h - z.col / 2;
  const busX = (j) => left + j * (b.cw + z.col) + z.col / 2;
  const places = new Map(), first = new Map(), second = new Map();
  const startA = [left, railA], startB = [left + b.w, railB];
  b.list.forEach((id, n) => {
    const col = n % b.k, row = Math.floor(n / b.k), s = size(id);
    const cx = busX(col) + (b.cw + z.col) / 2, cy = top + z.col + row * b.ch + b.ch / 2;
    places.set(id, [cx, cy]);
    const [busA, busB] = col % 2 ? [col + 1, col] : [col, col + 1];
    const end = (bus) => [busX(bus) < cx ? cx - s.w / 2 : cx + s.w / 2, cy];
    first.set(id, [startA, [busX(busA), railA], [busX(busA), cy], end(busA)]);
    second.set(id, [startB, [busX(busB), railB], [busX(busB), cy], end(busB)]);
  });
  return { places, first, second };
}
