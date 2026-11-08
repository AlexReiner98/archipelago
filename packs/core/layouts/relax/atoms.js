// What the relaxation moves (step 3, task e_7et8f4uv), read off the shape step 2 gives (its format on task e_7vp7udzk):
// on each axis, every box's two sides (so a box can grow to what passes it), every stretch of a wire that stands across
// that axis, every island's two sides and every point (a cross, a junction, a port), each a number. What must stand
// together is one number with an offset: a wire's points on one stretch, a wire's end and the side of its box it leaves
// by, a port and its island's side, two wires that share a stretch (a trunk). Layer: metrics. Pure: the shape in, the numbers and what each thing is out.

/** A union of keys, each kept as its root and its offset from it. */
function joiner() {
  const up = new Map();
  const add = (k) => (up.has(k) || up.set(k, [k, 0]), k);
  const find = (k) => {
    add(k);
    const [p, d] = up.get(k);
    if (p === k) return [k, 0];
    const [r, e] = find(p);
    up.set(k, [r, d + e]);
    return [r, d + e];
  };
  /** Joins b to a, so that b's number is a's plus `by`; false where they are joined already at another offset. */
  const join = (a, b, by = 0) => {
    const [ra, da] = find(a), [rb, db] = find(b);
    if (ra === rb) return Math.abs(db - da - by) < TOUCH;
    up.set(rb, [ra, da + by - db]);
    return true;
  };
  return { add, find, join, keys: () => [...up.keys()] };
}

/** How near two numbers of the sketch must be to count as one, and two extents to count as touching: under a grid unit. */
export const TOUCH = 0.5;

/** What the shape draws that is not drawn, so not placed: an island's border (its rectangle is) and the links nobody sees. */
const UNDRAWN = ['border', 'unseen'];

/** Whether a node is drawn as a box, with sides; else it is a point (a cross, a junction, a port). */
export const isBox = (n) => !!n && !!(n.size[0] || n.size[1]);

/** A node's numbers on an axis: a box's low and high sides (`b:id:0`, `b:id:1`), a point's place (`n:id`). */
export const keysOf = (n) => (isBox(n) ? [`b:${n.id}:0`, `b:${n.id}:1`] : [`n:${n.id}`]);

/** Whether a node's outline in the sketch holds a point. */
const holds = (n, p) => !!n && Math.abs(p[0] - n.x) <= n.w / 2 && Math.abs(p[1] - n.y) <= n.h / 2;

/** The node under a wire's end: the one named, or the smallest whose outline holds the point. */
function boxAt(nodes, p, named) {
  if (named) return nodes.get(named);
  let best = null;
  for (const n of nodes.values()) if (holds(n, p) && (!best || n.w * n.h < best.w * best.h)) best = n;
  return best;
}

/** A line without repeated points or points along a straight run, the ends kept. */
function tidied(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push([...p]);
  }
  return out;
}

/** Each box as long along each side as the ends the shape puts there need: a `wire` apart, `corner` from each end. */
function grown(nodes, wires, corner, wire) {
  const on = new Map();
  for (const w of wires) for (const [k, next] of [[0, 1], [w.points.length - 1, w.points.length - 2]]) {
    const box = w.ends[k ? 1 : 0], p = w.points;
    if (!isBox(box)) continue;
    const a = p[next][0] !== p[k][0] ? 0 : 1, side = `${box.id}|${a}|${Math.sign(p[next][a] - box[['x', 'y'][a]])}`;
    (on.get(side) ?? on.set(side, { box, b: 1 - a, at: new Set() }).get(side)).at.add(p[k][1 - a]);
  }
  for (const { box, b, at } of on.values()) box.size[b] = Math.max(box.size[b], 2 * corner + (at.size - 1) * wire);
}

/**
 * The shape read for the solve. `size(id)` is a node's drawn size [w, h] (a step as the flow measures it; 0 for a cross,
 * a junction or a port). Answers `nodes` (id to node, its sketch outline and drawn `size`), `wires` (each with tidy
 * `points` and its end boxes `ends`), `islands`, `ports`, and for each axis `axes[a]`: `find(key)` (root and offset),
 * `keys`, and the end ranges `ranges` ({ end, box, inset }: an end slides along its box's side within its corners).
 * A box grows along a side to hold the ends the shape puts there a `wire` apart, inside its `corner`s.
 */
export function atoms(shape, { size, corner, wire }) {
  const nodes = new Map(shape.nodes.filter((n) => !UNDRAWN.includes(n.kind)).map((n) => [n.id, { ...n, size: size(n) }]));
  const islands = new Map((shape.islands ?? []).map((i) => [i.id, i]));
  const ports = (shape.ports ?? []).map((p) => ({ ...p, node: nodes.get(p.id) }));
  const wires = shape.wires.filter((w) => !UNDRAWN.includes(w.type)).map((w) => ({ ...w, points: tidied(w.points) })).filter((w) => w.points.length > 1);
  const axes = [0, 1].map(() => ({ ...joiner(), ranges: [], refused: 0 }));
  for (const n of nodes.values()) for (const ax of axes) for (const key of keysOf(n)) ax.add(key);
  for (const i of islands.values()) for (const ax of axes) (ax.add(`i:${i.id}:0`), ax.add(`i:${i.id}:1`));
  for (const w of wires) {
    const p = w.points;
    // The link names its two items (`type from to`); an end is on one of them, or else on what holds its point.
    const named = w.from ? [w.from, w.to] : String(w.link ?? '').split(' ').slice(1);
    w.ends = [p[0], p.at(-1)].map((q) => boxAt(nodes, q, named.find((id) => holds(nodes.get(id), q))));
  }
  grown(nodes, wires, corner, wire);
  for (const w of wires) {
    const p = w.points;
    p.forEach((_, k) => axes.forEach((ax) => ax.add(`w:${w.id}:${k}`)));
    // The points of a stretch share the number of the axis it stands across.
    for (let k = 1; k < p.length; k++) for (const a of [0, 1]) if (p[k][a] === p[k - 1][a]) axes[a].join(`w:${w.id}:${k - 1}`, `w:${w.id}:${k}`);
    // An end on a box's side: on the axis it leaves across, the side's number; along that side, free inside its corners.
    for (const [k, next] of [[0, 1], [p.length - 1, p.length - 2]]) {
      const box = w.ends[k ? 1 : 0];
      if (!box) continue;
      const a = p[next][0] !== p[k][0] ? 0 : 1, way = Math.sign(p[next][a] - box[['x', 'y'][a]]) || 1, b = 1 - a;
      if (!isBox(box)) { for (const ax of axes) ax.join(`n:${box.id}`, `w:${w.id}:${k}`); continue; }
      if (!axes[a].join(`b:${box.id}:${way > 0 ? 1 : 0}`, `w:${w.id}:${k}`)) axes[a].refused++;
      axes[b].ranges.push({ end: `w:${w.id}:${k}`, lo: `b:${box.id}:0`, hi: `b:${box.id}:1`, inset: Math.min(corner, box.size[b] / 3), size: box.size[b] });
    }
  }
  // A point (a junction, a cross, a port) on a wire's stretch stands on that stretch's line.
  for (const n of nodes.values()) {
    if (isBox(n)) continue;
    for (const w of wires) w.points.forEach((q, k) => {
      if (!k) return;
      const o = w.points[k - 1];
      for (const a of [0, 1]) {
        const b = 1 - a;
        if (o[a] === q[a] && o[a] === n[['x', 'y'][a]] && n[['x', 'y'][b]] >= Math.min(o[b], q[b]) && n[['x', 'y'][b]] <= Math.max(o[b], q[b])) axes[a].join(`w:${w.id}:${k}`, `n:${n.id}`);
      }
    });
  }
  // A port stands on its island's side: on the axis across that side, the side's number. One the shape put on no side,
  // or off the side it names, is a free point.
  for (const p of ports) {
    const a = p.side === 'left' || p.side === 'right' ? 0 : 1, hi = p.side === 'right' || p.side === 'bottom' ? 1 : 0, i = islands.get(p.island);
    p.on = !!p.side && !!p.node && !!i && Math.abs(p.node[['x', 'y'][a]] - i.rect[a + 2 * hi]) < TOUCH;
    if (p.on) axes[a].join(`i:${p.island}:${hi}`, `n:${p.id}`);
  }
  // Two wires on one line along one another share that stretch: a trunk, one number.
  for (const a of [0, 1]) {
    const on = new Map();
    for (const w of wires) w.points.forEach((q, k) => {
      if (!k || w.points[k - 1][a] !== q[a]) return;
      const b = 1 - a, s = { key: `w:${w.id}:${k}`, lo: Math.min(q[b], w.points[k - 1][b]), hi: Math.max(q[b], w.points[k - 1][b]) };
      const list = on.get(q[a]) ?? on.set(q[a], []).get(q[a]);
      for (const t of list) if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > TOUCH) axes[a].join(t.key, s.key);
      list.push(s);
    });
  }
  return { nodes, wires, islands, ports, axes };
}
