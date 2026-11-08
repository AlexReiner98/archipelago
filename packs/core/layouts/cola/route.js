// The wires of a cola picture (task e_x7kwbu3e): every link at right angles on an orthogonal visibility grid (./grid.js),
// round the boxes; a wire between two items of one island kept inside it, one between islands through the sea and
// no third island. An order link runs from what is depended on to what depends on it, out of the foot of the one and
// into the head of the other; any other from its `from` to its `to`, by whichever sides are cheapest. Wires that run
// side by side are then parted into channels `z.channel` apart (./channels.js). Each wire ends on its boxes' outlines.
// Pure but for WebCola's nudging, handed in (`cola`): places in, wires out.
// Layer: metrics.

import { cheapest, doorsOf, gridOf } from './grid.js';
import { parted } from './channels.js';

const SIDES = ['bottom', 'top', 'right', 'left'];
/** Where a door's wire meets its box's outline: on the door's line, which may lie a little off the box's middle. */
const edgeOf = (box, side, grid, door) => (side === 'bottom' ? { x: grid.xs[door.i], y: box.y + box.h / 2 } : side === 'top' ? { x: grid.xs[door.i], y: box.y - box.h / 2 } : side === 'right' ? { x: box.x + box.w / 2, y: grid.ys[door.j] } : { x: box.x - box.w / 2, y: grid.ys[door.j] });

/** The wires: each { link, from, to, type, order, points: [[x, y], ...] }, `from` the end it leaves. */
export function routeOf(model, places, z, cola) {
  const boxes = new Map(places.boxes.map((b) => [b.id, b])), island = new Map(model.items.map((it) => [it.id, it.island]));
  const room = z.gap / 2;
  // An island's header (its name and legend) is kept clear as a box is.
  const heads = places.islands.filter((f) => f.head - room > f.t).map((f) => ({ x: (f.l + f.r) / 2, y: (f.t + f.head - room) / 2, w: f.r - f.l, h: f.head - room - f.t }));
  const grid = gridOf([...places.boxes, ...heads], places.islands, room, z.channel);
  const inside = (f, x, y) => x > f.l && x < f.r && y > f.t && y < f.b;
  const openFor = (a, b) => {
    const own = places.islands.filter((f) => f.id === island.get(a) || f.id === island.get(b));
    if (island.get(a) && island.get(a) === island.get(b)) return (i, j) => inside(own[0], grid.xs[i], grid.ys[j]);
    const others = places.islands.filter((f) => !own.includes(f));
    return (i, j) => !others.some((f) => inside(f, grid.xs[i], grid.ys[j]));
  };
  const wires = model.links.filter((l) => boxes.has(l.from) && boxes.has(l.to) && l.from !== l.to).map((l) => (l.order ? { link: l.id, from: l.to, to: l.from, type: l.type, order: true } : { link: l.id, from: l.from, to: l.to, type: l.type, order: false }));
  // Every wire's way on the grid, as the grid's shared points, from its box's outline to the other's.
  const outlines = new Map(), outline = (id, side) => outlines.get(`${id} ${side}`) ?? outlines.set(`${id} ${side}`, edgeOf(boxes.get(id), side, grid, doorsOf(grid, boxes.get(id), room, [side])[0])).get(`${id} ${side}`);
  const paths = wires.map((w) => {
    const a = boxes.get(w.from), b = boxes.get(w.to), open = openFor(w.from, w.to);
    const wayBy = (out, into, may) => {
      const usable = (d) => !grid.closed[d.i * grid.ys.length + d.j] && may(d.i, d.j);
      const starts = doorsOf(grid, a, room, out).filter(usable);
      // A wire comes into a box going the other way from how it would leave by that side.
      const ends = doorsOf(grid, b, room, into).filter(usable).map((d) => ({ ...d, d: d.d ^ 1 }));
      return starts.length && ends.length ? cheapest(grid, starts, ends, may, z.bend) : null;
    };
    // Where boxes close round a door, an order wire takes another side, and then any wire another island's water.
    const way = (w.order && wayBy(['bottom'], ['top'], open)) || wayBy(SIDES, SIDES, open) || wayBy(SIDES, SIDES, () => true);
    if (!way) w.unrouted = true;
    if (!way) return [outline(w.from, 'bottom'), { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, outline(w.to, 'top')];
    const first = way[0], last = way[way.length - 1];
    const side = (box, [i, j]) => doorsOf(grid, box, room, SIDES).find((d) => d.i === i && d.j === j).side;
    return [outline(w.from, side(a, first)), ...way.map(([i, j]) => grid.point(i, j)), outline(w.to, side(b, last))];
  });
  const routes = parted(paths, z.channel, cola);
  return wires.map((w, n) => {
    const segments = routes[n], points = [segments[0][0], ...segments.map((s) => s[1])];
    return { ...w, points: points.filter((p, k) => k === 0 || Math.abs(p.x - points[k - 1].x) > 0.01 || Math.abs(p.y - points[k - 1].y) > 0.01).map((p) => [p.x, p.y]) };
  });
}
